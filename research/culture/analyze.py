"""Диагностика ограниченного ZIP-префикса. Не нормализатор для production."""
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
import argparse
import codecs
import json
import re
import struct
import zlib


def read_prefix(blob, max_expanded=32 * 1024 * 1024):
    if len(blob) < 30 or blob[:4] != b'PK\x03\x04':
        raise ValueError('Ожидался префикс ZIP member, не произвольный HTTP-ответ')
    flags, method = struct.unpack_from('<HH', blob, 6)
    name_len, extra_len = struct.unpack_from('<HH', blob, 26)
    offset = 30 + name_len + extra_len
    if flags & 1 or method != 8 or offset >= len(blob):
        raise ValueError('Неподдерживаемый ZIP member')
    decompressor = zlib.decompressobj(-15)
    raw = decompressor.decompress(blob[offset:], max_expanded + 1)
    if len(raw) > max_expanded:
        raise ValueError('Превышен предел распаковки')
    text = codecs.getincrementaldecoder('utf-8')().decode(raw, final=decompressor.eof)
    if not text.lstrip().startswith('['):
        raise ValueError('Ожидался JSON-массив')
    decoder = json.JSONDecoder()
    pos = text.index('[') + 1
    rows = []
    while len(rows) < 10000:
        while pos < len(text) and text[pos].isspace():
            pos += 1
        if pos >= len(text) or text[pos] == ']':
            break
        try:
            row, end = decoder.raw_decode(text, pos)
        except json.JSONDecodeError:
            # Неполный/некорректный хвост НЕ считается записью или успешной полной загрузкой.
            break
        if not isinstance(row, dict):
            raise ValueError('Элемент массива не объект')
        rows.append(row)
        pos = end
        while pos < len(text) and text[pos].isspace():
            pos += 1
        if pos < len(text) and text[pos] == ',':
            pos += 1
        elif pos < len(text) and text[pos] != ']':
            raise ValueError('Неверный разделитель JSON')
    return rows, {'expanded_bytes': len(raw), 'complete_json_objects': len(rows),
                  'unparsed_tail_characters': len(text) - pos,
                  'complete_deflate': decompressor.eof, 'full_member_crc_verified': False}


def instant(value):
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return dt.astimezone(timezone.utc) if dt.tzinfo else None
    except ValueError:
        return None


def in_kazan(place):
    locale = place.get('locale') or {}
    address = (place.get('address') or {}).get('fullAddress', '')
    return (locale.get('name', '').strip().casefold() == 'казань'
            or locale.get('sysName') == 'kazan'
            or bool(re.search(r'(?:^|,)\s*(?:г\.?\s*|город\s+)казань(?:\s*,|\s*$)', address, re.I)))


def price_class(g):
    def number(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0
    low, high = g.get('price'), g.get('maxPrice')
    if g.get('isFree') is True:
        return 'CONFLICT' if any(number(v) and v > 0 for v in (low, high)) else 'FREE_DECLARED'
    if g.get('isFree') is False and low == 0:
        return 'CONFLICT'
    if not number(low):
        return 'UNKNOWN'
    if number(high):
        if high < low:
            return 'CONFLICT'
        return 'EXACT_PUBLISHED' if high == low else 'RANGE'
    return 'FROM_OR_UNSPECIFIED'


def overlaps(start, end, window_start, window_end):
    a, b = instant(start), instant(end)
    return bool(a and b and b > a and a < window_end and b > window_start)


def candidate_period(start, end, window_start, window_end):
    # Неизвестный end мешает строгому подбору, но не исключает запись из исследования.
    a = instant(start)
    return bool(a and window_start <= a < window_end) or overlaps(start, end, window_start, window_end)


def describe(rows, as_of):
    start = datetime.fromisoformat(as_of).replace(tzinfo=timezone(timedelta(hours=3)))
    end = start + timedelta(days=30)
    event_ids, venue_ids, intervals = set(), set(), set()
    target_ids, target_venues = set(), set()
    counts = Counter()
    prices, statuses = Counter(), Counter()
    source_updates, wrapper_updates, period_ends = [], [], []
    for row in rows:
        g = row['data']['general']
        info = row['data'].get('info') or {}
        event_ids.add(g['id'])
        places, seances = g.get('places') or [], g.get('seances') or []
        is_city = any(in_kazan(p) for p in places)
        counts['city_records'] += is_city
        counts['venue_occurrences_without_id'] += sum(p.get('id') is None for p in places)
        venue_ids.update(p['id'] for p in places if p.get('id') is not None)
        counts['published_interval_entries'] += len(seances)
        intervals.update((g['id'], s.get('start'), s.get('end')) for s in seances)
        relevant = candidate_period(g.get('start'), g.get('end'), start, end) or any(
            candidate_period(s.get('start'), s.get('end'), start, end) for s in seances)
        counts['records_overlapping_window_any_city'] += relevant
        counts['target_records'] += is_city and relevant
        if is_city and relevant:
            target_ids.add(g['id'])
            target_venues.update(p['id'] for p in places if p.get('id') is not None and in_kazan(p))
        counts['missing_age'] += g.get('ageRestriction') is None
        counts['missing_sale_link'] += not bool(g.get('saleLink'))
        counts['missing_explicit_event_url'] += not bool(g.get('url') or info.get('url'))
        counts['missing_period_start_or_end'] += not (instant(g.get('start')) and instant(g.get('end')))
        counts['multi_venue_records'] += len(places) > 1
        prices[price_class(g)] += 1
        statuses[str(g.get('status'))] += 1
        for value, dest in [(info.get('updateDate'), source_updates), (row.get('modified'), wrapper_updates), (g.get('end'), period_ends)]:
            parsed = instant(value)
            if parsed:
                dest.append(parsed.isoformat())
    def span(values):
        return [min(values), max(values)] if values else None
    return {'window_start': start.isoformat(), 'window_end_exclusive': end.isoformat(),
            'raw_complete_records': len(rows), 'distinct_events': len(event_ids),
            'distinct_venues_with_id': len(venue_ids), 'distinct_published_intervals': len(intervals),
            'target_distinct_events': len(target_ids), 'target_distinct_venues_with_id': len(target_venues),
            'counts': dict(counts), 'prices': dict(prices), 'source_statuses': dict(statuses),
            'source_update_range': span(source_updates), 'wrapper_modified_range': span(wrapper_updates),
            'event_period_end_range': span(period_ends),
            'sampling': 'POSITIONAL_ARCHIVE_DIAGNOSTIC_NOT_CITY_COVERAGE'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prefix', type=Path)
    parser.add_argument('--as-of', default=datetime.now(timezone(timedelta(hours=3))).date().isoformat())
    args = parser.parse_args()
    if args.prefix.stat().st_size > 4 * 1024 * 1024:
        raise SystemExit('Предел сжатого префикса — 4 MiB')
    rows, parsing = read_prefix(args.prefix.read_bytes())
    print(json.dumps({'parsing': parsing, 'sample': describe(rows, args.as_of)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
