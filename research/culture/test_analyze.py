"""Только SYNTHETIC_FIXTURE; реальные ответы поставщика здесь не хранятся."""
from datetime import datetime, timezone
import json
import struct
import unittest
import zlib

from analyze import describe, in_kazan, instant, overlaps, price_class, read_prefix


def zip_fragment(payload):
    compressor = zlib.compressobj(wbits=-15)
    data = compressor.compress(payload) + compressor.flush(zlib.Z_SYNC_FLUSH)
    header = struct.pack('<4s5H3I2H', b'PK\x03\x04', 20, 0, 8, 0, 0, 0, 0, 0, 9, 0)
    return header + b'test.json' + data


def record(event_id=1, venue_id=2):
    return {'data': {'general': {
        'id': event_id, 'isFree': True, 'ageRestriction': 0,
        'start': '2026-09-26T11:00:00Z', 'end': '2026-09-26T12:00:00Z',
        'places': [{'id': venue_id, 'locale': {'name': 'Казань'}}],
        'seances': [{'start': '2026-09-26T11:00:00Z', 'end': '2026-09-26T12:00:00Z'}],
    }, 'info': {'updateDate': '2026-09-01T00:00:00Z'}}, 'modified': '2026-09-23T00:00:00Z'}


class AnalysisTest(unittest.TestCase):
    def test_partial_record_and_utf8_tail_are_not_counted(self):
        first = json.dumps(record(), ensure_ascii=False).encode('utf-8')
        rows, result = read_prefix(zip_fragment(b'[' + first + b', {"x":"' + 'я'.encode()[:1]))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['data']['general']['id'], 1)
        self.assertFalse(result['complete_deflate'])
        self.assertFalse(result['full_member_crc_verified'])

    def test_oversized_expansion_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'предел распаковки'):
            read_prefix(zip_fragment(b'[' + b' ' * 2000), max_expanded=1000)

    def test_http_error_is_not_a_zip(self):
        with self.assertRaises(ValueError):
            read_prefix(b'<html>Access denied</html>')

    def test_invalid_json_separator_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'разделитель'):
            read_prefix(zip_fragment(b'[{"a":1}garbage]'))

    def test_street_and_district_are_not_kazan(self):
        self.assertFalse(in_kazan({'locale': {'name': 'Казанский район', 'sysName': 'kazanskiy-rayon'}}))
        self.assertFalse(in_kazan({'address': {'fullAddress': 'г Елабуга, ул Казанская, д 24'}}))
        self.assertTrue(in_kazan({'address': {'fullAddress': 'Респ Татарстан, г Казань, ул Кремлевская, д 1'}}))

    def test_unknown_minimum_conflict_and_exact_prices(self):
        self.assertEqual(price_class({}), 'UNKNOWN')
        self.assertEqual(price_class({'isFree': False}), 'UNKNOWN')
        self.assertEqual(price_class({'price': 200}), 'FROM_OR_UNSPECIFIED')
        self.assertEqual(price_class({'price': 200, 'maxPrice': 500}), 'RANGE')
        self.assertEqual(price_class({'price': 200, 'maxPrice': 200}), 'EXACT_PUBLISHED')
        self.assertEqual(price_class({'isFree': True, 'price': 300}), 'CONFLICT')
        self.assertEqual(price_class({'isFree': False, 'price': 0}), 'CONFLICT')
        self.assertEqual(price_class({'isFree': True}), 'FREE_DECLARED')

    def test_naive_unknown_and_zero_duration_are_not_intervals(self):
        self.assertIsNone(instant('2026-09-26 14:00'))
        start = datetime(2026, 9, 23, tzinfo=timezone.utc)
        end = datetime(2026, 10, 23, tzinfo=timezone.utc)
        self.assertFalse(overlaps('2026-09-26T14:00:00Z', None, start, end))
        self.assertFalse(overlaps('2026-09-26T14:00:00Z', '2026-09-26T14:00:00Z', start, end))

    def test_events_sessions_and_venues_are_separate(self):
        rows = [record(), record(), record(event_id=3)]
        report = describe(rows, '2026-09-23')
        self.assertEqual(report['raw_complete_records'], 3)
        self.assertEqual(report['distinct_events'], 2)
        self.assertEqual(report['distinct_venues_with_id'], 1)
        self.assertEqual(report['distinct_published_intervals'], 2)
        self.assertEqual(report['target_distinct_events'], 2)
        self.assertEqual(report['source_update_range'][0], '2026-09-01T00:00:00+00:00')
        self.assertEqual(report['wrapper_modified_range'][0], '2026-09-23T00:00:00+00:00')

    def test_unknown_end_is_a_research_candidate_not_a_known_interval(self):
        r = record()
        r['data']['general']['end'] = None
        r['data']['general']['seances'] = []
        report = describe([r], '2026-09-23')
        self.assertEqual(report['target_distinct_events'], 1)
        self.assertEqual(report['counts']['missing_period_start_or_end'], 1)

    def test_old_data_is_not_current_and_recommendation_is_not_venue(self):
        r = record()
        r['data']['general'].update(start='2021-03-01T00:00:00Z', end='2021-03-02T00:00:00Z', seances=[])
        self.assertEqual(describe([r], '2026-09-23')['counts']['target_records'], 0)
        r = record()
        r['data']['general']['places'] = [{'id': 2, 'locale': {'name': 'Елабуга'}}]
        r['data']['general']['recommendations'] = [{'name': 'Казань'}]
        self.assertEqual(describe([r], '2026-09-23')['counts']['city_records'], 0)


if __name__ == '__main__':
    unittest.main()
