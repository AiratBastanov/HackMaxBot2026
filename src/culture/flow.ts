import { randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import type { AcceptedEvent } from '../contracts.js';
import { type Query, partySchema, safeLink } from '../data/contract.js';
import { select, assess } from '../data/select.js';
import { sourceReviews } from '../data/reviews.js';
import { deliveryAllowed, type Button, type MaxOperation } from '../max.js';
import { canSend, observeContact } from '../probe.js';
import type { Storage } from '../storage.js';
import { Catalog } from './catalog.js';
import { type Card, projectCard, fingerprint, compact, presentationTitle, cardOverview, cardPages, cardPrice, displayDate, displayDay, displayInterval } from './card.js';
import { cities, cityKeySchema, cityDate, resolveCity, offsetHours, type CityKey } from '../data/cities.js';
import { activeScreen, desireScreen } from '../screens.js';
import { currentBookmark, bookmarkContext, alreadySaved, saveBookmark } from './bookmark.js';
import { themeLabels, themeLabel, dateProblem, timeProblem, nextDate, migrateDraft, type Draft, type LegacyDraft } from './preferences.js';
import { dayQuery, type SearchQuery } from '../data/temporal.js';
export type { Card } from './card.js';
export { fingerprint } from './card.js';

type Stage = 'home' | 'city' | 'party' | 'ages' | 'date' | 'time' | 'budget' | 'interest' | 'summary' | 'results' | 'detail' | 'saved' | 'bookmark' | 'input' | 'delete' | 'erase' | 'about' | 'leave';
type InputField = 'city' | 'date' | 'time' | 'budget' | 'adults' | 'children' | 'ages';
type State = { stage: Stage; draft: Draft; editing: boolean; optIn: boolean; cards: Card[];
  route?: 'probe';
  selected?: string; page: number; conditionPage?: number; bookmark?: { identity: string; generation: string };
  input?: { field: InputField; token: string }; notice?: string; cityOptions?: CityKey[]; returnView?: {stage:Stage;conditionPage?:number};
  editBase?:Draft; resumeStage?:Stage; savedReturn?:Stage;
  leave?:{purpose:string;arg:string;selected:string;conditionPage?:number;failed?:boolean} };
export type StateRow = { actor: string; revision: number; event_ts: number; updated_at: number; data: string };
type Action = { actor: string; revision: number; purpose: string; data: string; expires_at: number };
type Bookmark = { identity: string; generation: string; data: string; saved_at: number };
const TTL = 15 * 60000;
const label = (c: Card) => c.kind === 'STRICT' ? 'Подходит по известным условиям' : 'Нужно уточнить условия';
const datePlus = (now: number, days: number, city: CityKey = 'kzn') => cityDate(new Date(now + days * 86400000).toISOString(),cities[city].timezone);
const dateChoice=(d:Draft)=>d.date.mode==='ANY'?'любая':displayDate(d.date.date);
const dateHeading=(s:State)=>`📅 ${s.draft.date.mode==='ANY'?'Любая дата':displayDay(s.draft.date.date)} · ${cities[s.draft.city!].name}`;
const localTimeNote=(s:State)=>`Время местное — UTC+${offsetHours(cities[s.draft.city!].timezone)}.`;
export function getState(store: Storage, actor: string) { return store.db.prepare('SELECT * FROM flow_states WHERE actor=?').get(actor) as StateRow | undefined; }
export function makeQuery(d: LegacyDraft): Query;
export function makeQuery(d: Draft): Query|SearchQuery;
export function makeQuery(input: Draft|LegacyDraft): Query|SearchQuery {
  const d=migrateDraft(input);
  const city=d.city??'kzn',timezone=cities[city].timezone;
  const q:SearchQuery={ version:2,city,timezone,party:partySchema.parse(d.party??{adults:1,childAges:[]}),budgetBasis:'PARTY_TOTAL',date:d.date,time:d.time,
    budgetRub: d.budget, category: null, zone: null, kind: 'ANY', preferences: { categories: d.category ? [d.category] : [] } };
  return d.date.mode==='SPECIFIC'&&d.time.mode==='SPECIFIC'?dayQuery(q,d.date.date):q;
}
function initial(now: number): State {
  return { stage: 'home', draft: { city:'kzn',party:{adults:1,childAges:[]},budgetBasis:'PARTY_TOTAL',date:{mode:'SPECIFIC',date:datePlus(now,1)},time:{mode:'SPECIFIC',from:'12:00',until:'18:00'}, budget: 500, category: null }, editing: false, optIn: false, cards: [], page: 0 };
}
export function enterProbeRoute(store: Storage, event: AcceptedEvent, now: number) {
  const previous = getState(store,event.actor);
  const state = { ...initial(now), route: 'probe' };
  store.db.prepare('INSERT INTO flow_states(actor,revision,event_ts,updated_at,data) VALUES(?,?,?,?,?) ON CONFLICT(actor) DO UPDATE SET revision=excluded.revision,event_ts=excluded.event_ts,updated_at=excluded.updated_at,data=excluded.data')
    .run(event.actor,(previous?.revision ?? 0)+1,event.timestamp,now,JSON.stringify(state));
}
function summary(s: State) {
  const city=s.draft.city??'kzn',p=s.draft.party??{adults:1,childAges:[]};
  const t=s.draft.time,time=t.mode==='ANY'?'любое':`${t.from}–${t.until<t.from?(s.draft.date.mode==='SPECIFIC'?displayDate(nextDate(s.draft.date.date))+' · ':'следующий день · '):''}${t.until}`;
  return `📍 ${cities[city].name}\nДата: ${dateChoice(s.draft)}\nВремя: ${time} (UTC+${offsetHours(cities[city].timezone)})\nПосетители: ${p.adults} взр., ${p.childAges.length} дет.${p.childAges.length?` · возраст (лет): ${p.childAges.map(a=>a===null?'не указан':String(a)).join(', ')}`:''}\nБюджет на вход для всех: ${s.draft.budget === null ? 'без лимита' : `до ${s.draft.budget} ₽`}.\nТема: ${themeLabel(s.draft.category)}.`;
}
export function bookmarkLimitation(c: Card, catalog: Catalog, now: number): string | null {
  if (sourceReviews.some(r => r.eventId === c.eventId)) return 'Сведения о событии противоречат друг другу. Выберите другое событие.';
  const snapshot=catalog.forCity(c.query.city);
  if (!snapshot) return 'Текущие сведения недоступны. Проверьте сохранённую ссылку.';
  if (!snapshot.events.some(e => e.id === c.eventId && (!c.occurrenceId || e.occurrences.some(o => o.id === c.occurrenceId))))
    return 'События или выбранного посещения сейчас нет в каталоге. Это не подтверждение отмены. Проверьте источник.';
  if (fingerprint(catalog, c.eventId,c.query.city) !== c.fingerprint) return 'Данные изменились. Ниже условия при сохранении. Выполните новый подбор.';
  if (now - Date.parse(c.retrievedAt) > snapshot.freshnessHours*3600000 || now >= Date.parse(c.visit?.until??c.query.end)) return 'Сохранённые условия или выбранная дата устарели. Повторите подбор и проверьте источник.';
  return null;
}
const statuses: Record<string, string> = {
  SOURCE_UNAVAILABLE: 'Данные сейчас недоступны. Попробуйте позже или откройте «Мои события».',
  OUTSIDE_SNAPSHOT_SCOPE: 'На выбранную дату данных нет в загруженной части афиши. Это не означает, что событий нет. Вернитесь к параметрам и выберите другую дату.',
  SOURCE_STALE: 'Данные устарели. Для подбора нужно обновление; попробуйте позже.',
  INCOMPLETE_CATALOG: 'Подходящих событий в доступной части афиши нет. Измените дату, время или бюджет.',
  INSUFFICIENT_FACTS: 'Не хватает сведений для подбора. Можно посмотреть события, условия которых нужно уточнить.',
  NO_MATCHES_IN_SNAPSHOT: 'По этим условиям событий не найдено. Измените дату, время или бюджет.',
};

// Вызывается в существующей короткой SQLite-транзакции. Selector синхронен и не обращается к сети/файлам.
export function processCulture(store: Storage, config: Config, event: AcceptedEvent, now: number, catalog: Catalog): string {
  if(event.kind!=='message_callback'||!activeScreen(store,event.actor)||event.chat===activeScreen(store,event.actor)?.chat) observeContact(store, event, now);
  if (!canSend(store.contact(event.actor))) return 'CONTACT_UNAVAILABLE';
  if (!['bot_started', 'message_created', 'message_callback'].includes(event.kind)) return 'LIFECYCLE_RECORDED';
  if (event.kind === 'bot_started' && !event.homeEntry) return 'UNKNOWN_ENTRY';
  const old = getState(store, event.actor);
  let s: State = old ? JSON.parse(old.data) : initial(now);
  s.draft=migrateDraft(s.draft);if(s.editBase)s.editBase=migrateDraft(s.editBase);
  // Прежний flow имел ровно Казань/одного взрослого. Закладки не переписываются.
  s.draft.city??='kzn';s.draft.party??={adults:1,childAges:[]};s.draft.budgetBasis??='PARTY_TOTAL';
  const revision = (old?.revision ?? 0) + 1;
  let purpose = 'home', arg = '';
  let saveOutcome:'FLOW_BOOKMARK_CREATED'|'FLOW_BOOKMARK_EXISTS'|undefined;
  let valid = true;
  if (event.kind === 'message_callback') {
    const action = event.flowAction ? store.db.prepare('SELECT * FROM flow_actions WHERE id=?').get(event.flowAction) as Action | undefined : undefined;
    valid = Boolean(action && action.purpose!=='dateBack' && old && action.actor === event.actor && action.revision === old.revision && action.expires_at > now
      && (!event.mid || event.mid === activeScreen(store,event.actor)?.mid)
      && (!event.chat || !activeScreen(store,event.actor) || event.chat === activeScreen(store,event.actor)?.chat)
      && event.timestamp >= old.event_ts && event.timestamp <= now + 60000 && now - event.timestamp < TTL && now - old.updated_at < TTL);
    if (valid) { purpose = action!.purpose; arg = JSON.parse(action!.data) as string; }
    const processedSave=!valid&&event.flowAction&&(store.db.prepare('SELECT 1 FROM bookmarks WHERE actor=? AND save_action=?').get(event.actor,event.flowAction)
      ||store.db.prepare("SELECT 1 FROM inbox WHERE status='PROCESSED' AND result='FLOW_BOOKMARK_EXISTS' AND json_extract(payload,'$.actor')=? AND json_extract(payload,'$.flowAction')=? LIMIT 1").get(event.actor,event.flowAction));
    store.enqueue(`${event.key}:answer`, event.actor, null, 'culture_answer', { method: 'answers', callbackId: event.callbackId!, body: {
      notification: valid ? 'Принято.' : processedSave?'Это сохранение уже обработано. Новая запись не добавлена.':'Кнопка устарела или принадлежит другому диалогу. Откройте /start.',
    } }, now, now + 60000);
    if (!valid) return 'FLOW_ACTION_EXPIRED_OR_FOREIGN';
  } else if (old && event.timestamp < old.event_ts) return 'FLOW_OLDER_EVENT';
  else if (event.timestamp > now + 60000 || now - event.timestamp >= TTL) return 'FLOW_EVENT_EXPIRED';
  else if (event.homeEntry) purpose = 'home';
  else if (event.input === '/saved') purpose = 'saved';
  else if (event.input === '/delete_data') purpose = 'erase';
  else if ((s.stage === 'city'||s.stage==='input'&&s.input?.field==='city') && old && now-old.updated_at<TTL) purpose = 'cityText';
  else if (s.stage === 'input' && old && now - old.updated_at < TTL) purpose = 'typed';
  else { purpose = 'recover'; }

  delete s.notice;
  if ((purpose==='cityText'||purpose==='typed') && event.replyMid && (event.replyMid!==activeScreen(store,event.actor)?.mid || event.replyChat && event.replyChat!==event.chat)) return 'FLOW_STALE_REPLY';
  const previousDraft=structuredClone(s.draft);
  const changed = (next: Stage) => {
    if(JSON.stringify(makeQuery(s.editBase??previousDraft))!==JSON.stringify(makeQuery(s.draft))) {
      s.optIn=false;s.cards=[];delete s.selected;
    }
    delete s.input;s.stage=s.editing?'summary':next;s.editing=false;delete s.editBase;
  };
  const cancelEdit=()=>{if(s.editBase)s.draft=s.editBase;delete s.editBase;delete s.input;s.editing=false;s.stage='summary';};
  const findBookmark = () => s.bookmark ? store.db.prepare('SELECT * FROM bookmarks WHERE actor=? AND identity=? AND generation=?').get(event.actor, s.bookmark.identity, s.bookmark.generation) as Bookmark | undefined : undefined;
  const selected=()=>s.cards.find(c=>c.identity===s.selected);
  const saveSelected=():boolean=>{
    const c=selected();
    if(c&&alreadySaved(store,event.actor,c)){saveOutcome='FLOW_BOOKMARK_EXISTS';s.notice='✅ Уже сохранено. Новая запись не добавлена.';return true;}
    const snapshot=c&&catalog.forCity(c.query.city),e=snapshot?.events.find(e=>e.id===c?.eventId),o=e?.occurrences.find(o=>o.id===c?.occurrenceId);
    if(!c||c.snapshotVersion!==catalog.version||(c.kind==='UNCERTAIN'&&!s.optIn)||!e||!snapshot||bookmarkLimitation(c,catalog,now)
      ||assess(e,o,snapshot.venues.find(v=>v.id===o?.venueId),c.query,now,snapshot.freshnessHours).hard.length
      ||!c.synthetic&&(config.mode==='live'||catalog.requiresReview)&&!catalog.permits(c.displayRef?[c.displayRef]:undefined,now)) {
      s.notice='Выбранное посещение сейчас недоступно для сохранения. Вернитесь к подбору или отмените выбор.';return false;
    }
    try {
      const result=saveBookmark(store,event.actor,c,event.flowAction!,now);
      if(result.kind==='LIMIT'){s.notice='Лимит 50 закладок. Удалите ненужную в «Мои события» или отмените выбор.';return false;}
      saveOutcome=result.kind==='CREATED'?'FLOW_BOOKMARK_CREATED':'FLOW_BOOKMARK_EXISTS';
      s.notice=(result.kind==='EXISTING'?'✅ Уже сохранено. Новая запись не добавлена.':result.overlap?'✅ Сохранено. На это время у вас уже есть другое событие.':'✅ Сохранено.')+
        '\n'+presentationTitle(c)+'\nЗакладка в «Мои события». Это не покупка билета и не регистрация.';
      return true;
    }catch {s.notice='Не удалось сохранить закладку. Попробуйте ещё раз или отмените выбор; карточка остаётся доступна.';return false;}
  };
  // Перехватываем только уход с действительно открытой карточки. Условия и ссылки свободны.
  const exits=['home','pick','edit','results','saved','bookmark','detail','uncertain','back','recover'];
  if(['detail','leave'].includes(s.stage)&&selected()&&!alreadySaved(store,event.actor,selected()!)&&exits.includes(purpose)&&!(purpose==='detail'&&arg===s.selected)) {
    s.leave={purpose,arg,selected:s.selected!,conditionPage:s.conditionPage,failed:s.leave?.failed};s.stage='leave';purpose='showLeave';
  }
  if(purpose==='saveAndLeave'||purpose==='discardAndLeave') {
    if(!s.leave){purpose='recover';}
    else if(purpose==='discardAndLeave'&&s.leave.failed||purpose==='saveAndLeave'&&saveSelected()) {
      const discarded=purpose==='discardAndLeave';
      const destination=s.leave;delete s.leave;delete s.conditionPage;s.stage='detail';
      purpose=destination.purpose;arg=destination.arg;if(discarded){delete s.selected;if(purpose==='home')s.stage='results';}
    }else {s.leave.failed=true;purpose='showLeave';}
  }
  switch (purpose) {
    case 'home':
      if(s.route==='probe')s=initial(now);
      // Список/приватность — временные разделы: они не заменяют точку продолжения анкеты.
      if(['city','date','time','party','ages','budget','interest','input','summary','results','detail','leave'].includes(s.stage))s.resumeStage=s.stage;
      s.stage='home';break;
    case 'pick': s = initial(now); s.stage = 'city'; break;
    case 'resume': s.stage=s.resumeStage??'summary';delete s.resumeStage;break;
    case 'edit': s.editBase=structuredClone(s.draft);s.stage = arg as Stage; s.editing = true;break;
    case 'back': {
      if(s.editing){cancelEdit();break;}
      const prior:Partial<Record<Stage,Stage>>={city:'home',date:'city',time:'date',party:'time',ages:'party',budget:s.draft.party!.childAges.length?'ages':'party',interest:'budget',summary:'interest',results:'summary',detail:'results',bookmark:'saved',saved:s.savedReturn??'home',about:'home'};
      s.stage=prior[s.stage]??'home';delete s.conditionPage;break;
    }
    case 'inputBack': s.stage = ['adults','children'].includes(s.input!.field)?'party':s.input!.field as Stage; delete s.input; break;
    case 'cityText': {
      const matches=resolveCity(event.input??'');
      if(matches.length!==1) {s.cityOptions=matches;if(matches.length)s.stage='city';s.notice=matches.length?'Уточните город кнопкой.':'Не удалось распознать город. Выберите кнопку или введите другое название.';break;}
      arg=matches[0]!;
      // falls through only for the resolved canonical key
    }
    case 'city': {
      const city=cityKeySchema.parse(arg);
      if(!catalog.usableCities(now).includes(city)) {s.stage='city';s.notice=`${cities[city].name}: данные сейчас недоступны. Выберите другой город или попробуйте позже.`;break;}
      s.draft.city=city;delete s.cityOptions;changed('date');break;
    }
    case 'date':
      // Сохранённый ISO-аргумент: «Завтра» не пересчитывается при нажатии.
      if(dateProblem(arg,now,s.draft.city!)){s.stage='date';s.notice=dateProblem(arg,now,s.draft.city!)!;valid=false;break;}
      s.draft.date = {mode:'SPECIFIC',date:arg}; changed('time'); break;
    case 'anyDate': s.draft.date={mode:'ANY'};changed('time');break;
    case 'anyTime': s.draft.time={mode:'ANY'};changed('party');break;
    case 'time':
      if(timeProblem(arg,s.draft.date,now,s.draft.city!)){s.notice=timeProblem(arg,s.draft.date,now,s.draft.city!)!;valid=false;break;}
      {const [from,until]=arg.split('-') as [string,string];s.draft.time={mode:'SPECIFIC',from,until};} changed('party'); break;
    case 'partyAdjust': {
      const [field,delta]=arg.split(':'),p=structuredClone(s.draft.party!);
      if(field==='adults') p.adults+=Number(delta);else if(Number(delta)>0)p.childAges.push(null);else p.childAges.pop();
      if(!partySchema.safeParse(p).success) {s.notice='Нужен хотя бы один взрослый; всего до 8 посетителей.';break;}
      s.draft.party=p;s.draft.budget=null;if(!s.editing){s.optIn=false;s.cards=[];delete s.selected;}s.notice='Состав изменён. Задайте бюджет на всех заново.';break;
    }
    case 'partyDone': s.stage=s.draft.party!.childAges.length?'ages':'budget';break;
    case 'agesUnknown': s.draft.party!.childAges=s.draft.party!.childAges.map(()=>null);s.stage='budget';break;
    case 'budget': s.draft.budget = arg === 'none' ? null : Number(arg); changed('interest'); break;
    case 'interest': if(arg&&!Object.hasOwn(themeLabels,arg)){s.notice='Эта тема недоступна. Выберите тему кнопкой.';valid=false;break;}s.draft.category = arg || null; changed('summary'); break;
    case 'custom': s.input = { field: arg as InputField, token: randomBytes(3).toString('hex').toUpperCase() }; s.stage = 'input'; break;
    case 'typed': {
      const token=(event.input??'').slice(0,6),value=(event.input??'').slice(7).trim();
      const input = s.input;
      valid = Boolean(input && token === input.token && value);
      if (valid && input?.field === 'date') {
        const problem=dateProblem(value,now,s.draft.city!);valid=!problem;if(problem)s.notice=problem;
        if (valid) { s.draft.date = {mode:'SPECIFIC',date:value}; changed('time'); }
      } else if (valid && input?.field === 'time') {
        const problem=timeProblem(value,s.draft.date,now,s.draft.city!);valid=!problem;if(problem)s.notice=problem;
        if (valid) { const [from,until]=value.split('-') as [string,string];s.draft.time={mode:'SPECIFIC',from,until}; changed('party'); }
      } else if (valid && input?.field === 'budget') {
        valid = /^\d{1,5}$/.test(value!) && Number(value) <= 100000;
        if (valid) { s.draft.budget = Number(value); changed('interest'); }
      } else if (valid && input && ['adults','children','ages'].includes(input.field)) {
        const p=structuredClone(s.draft.party!);
        if(input.field==='ages') {
          const items=value.split(',').map(v=>v.trim());valid=items.length===p.childAges.length&&items.every(v=>v==='?'||/^\d{1,2}$/.test(v));
          if(valid)p.childAges=items.map(v=>v==='?'?null:Number(v));
        } else {valid=/^\d{1,2}$/.test(value)&&Number(value)<=8;if(valid) {if(input.field==='adults')p.adults=Number(value);else p.childAges=Array.from({length:Number(value)},()=>null);}}
        valid=valid&&partySchema.safeParse(p).success;
        if(valid){s.draft.party=p;s.draft.budget=null;if(!s.editing){s.optIn=false;s.cards=[];delete s.selected;}s.stage=input.field==='ages'?'budget':'party';delete s.input;}
      }
      if (!valid) {
        const problems:Record<InputField,string>={city:'Введите название города.',date:'Нужна действительная дата сегодня или в будущем в формате ГГГГ-ММ-ДД.',time:'Нужен ещё не закончившийся интервал: ЧЧ:ММ-ЧЧ:ММ.',budget:'Сумма должна быть целым числом от 0 до 99999.',adults:'Нужен хотя бы один взрослый, всего до 8 посетителей.',children:'Можно указать до 7 детей, всего до 8 посетителей.',ages:'Укажите по одному возрасту 0–17 или ? на каждого ребёнка.'};
        s.notice=/^[A-F0-9]{6}$/.test(token)&&token!==input?.token?'Код ввода устарел. Отправьте ответ с кодом ниже.':`${s.notice??(input?problems[input.field]:'Ввод не распознан.')} Исправьте ответ с кодом ниже.`;
      }
      break;
    }
    case 'results': s.stage = 'results'; break;
    case 'uncertain': s.optIn = true; s.stage = 'results'; break;
    case 'detail': s.selected = arg; s.stage = 'detail'; delete s.conditionPage; break;
    case 'conditions': s.conditionPage = Number(arg || 0); break;
    case 'conditionOverview': delete s.conditionPage; break;
    case 'save': if(!saveSelected()){s.leave={purpose:'results',arg:'',selected:s.selected??'',failed:true};s.stage='leave';}break;
    case 'showLeave': break;
    case 'stay': s.stage='detail';s.conditionPage=s.leave?.conditionPage;delete s.leave;break;
    case 'saved': if(!['saved','bookmark','delete'].includes(s.stage))s.savedReturn=s.stage==='detail'?'results':s.stage;s.stage = 'saved'; s.page = Number(arg || 0);delete s.conditionPage;break;
    case 'bookmark': {
      s.bookmark = JSON.parse(arg);
      if(s.stage==='detail') {
        const ordered=store.db.prepare('SELECT identity FROM bookmarks WHERE actor=? ORDER BY saved_at DESC,identity').all(event.actor) as {identity:string}[];
        s.page=Math.max(0,Math.floor(ordered.findIndex(b=>b.identity===s.bookmark?.identity)/5));s.savedReturn='results';
      }
      s.stage = 'bookmark'; delete s.conditionPage;break;
    }
    case 'remove': if(arg)s.bookmark=JSON.parse(arg);s.returnView={stage:s.stage,conditionPage:s.conditionPage};s.stage = 'delete'; delete s.conditionPage; break;
    case 'cancel': s.stage=s.returnView?.stage??'home';s.conditionPage=s.returnView?.conditionPage;delete s.returnView;break;
    case 'confirmRemove': {
      const removed=s.bookmark&&store.db.prepare('DELETE FROM bookmarks WHERE actor=? AND identity=? AND generation=?').run(event.actor, s.bookmark.identity, s.bookmark.generation).changes;
      s.stage = 'saved';s.notice = removed?'Закладка удалена.':'Эта закладка уже удалена.';
      delete s.selected;delete s.bookmark;delete s.leave;delete s.returnView;break;
    }
    case 'erase': s.returnView={stage:s.stage,conditionPage:s.conditionPage};s.stage = 'erase'; break;
    case 'confirmErase':
      // Удаление фиксируется до сети. В очереди остаётся лишь короткое подтверждение;
      // его сбой/срок/новый вход не могут отменить удаление или стереть новый диалог.
      store.erasePersonal(event.actor,now);
      if(event.callbackId)store.enqueue(`${event.key}:erased-answer`,event.actor,null,'culture_erasure',{method:'answers',callbackId:event.callbackId,forgetAfterSend:true,
        body:{notification:'Ваши данные удалены.'}},now,now+60000);
      store.enqueue(`${event.key}:erased`,event.actor,null,'culture_erasure',{method:'messages',recipient:event.actor,forgetAfterSend:true,
        body:{text:'Ваши данные удалены. Для нового подбора отправьте /start.',notify:false,attachments:[]}},now,now+60000);
      return 'FLOW_ERASED';
    case 'about': s.stage = 'about'; break;
    default: s.stage = 'home'; s.notice = 'Выберите действие кнопкой. Для нового входа: /start.';
  }
  // Любой принятый переход закрывает старые действия/отложенные экраны.
  store.db.prepare('DELETE FROM flow_actions WHERE actor=?').run(event.actor);
  store.db.prepare("UPDATE outbox SET status='STALE',result='FLOW_REVISION_CHANGED',finished_at=? WHERE actor=? AND status='PENDING' AND flow_revision IS NOT NULL").run(now, event.actor);
  const button = (text: string, purpose: string, data = ''): Button => {
    const id = randomBytes(18).toString('base64url');
    store.db.prepare('INSERT INTO flow_actions(id,actor,revision,purpose,data,expires_at) VALUES(?,?,?,?,?,?)').run(id, event.actor, revision, purpose, JSON.stringify(data), now + TTL);
    return { type: 'callback', text, payload: `cp:${id}` };
  };
  const home = () => [button('Главная', 'home'), button('Мои события', 'saved')];
  const formNav=()=>[button('Назад','back'),button('В меню','home')];
  const editors = () => [[button('Город', 'edit', 'city'),button('Посетители','edit','party')],[button('Дата', 'edit', 'date'), button('Время', 'edit', 'time')], [button('Бюджет', 'edit', 'budget'), button('Тема', 'edit', 'interest')]];
  let text = '', rows: Button[][] = [], audience: MaxOperation['audience'], catalogVersion: string | undefined;
  const displayRefs:NonNullable<MaxOperation['displayRefs']>=[];
  const showCard=(c:Card)=>c.synthetic||config.mode==='local'&&!catalog.requiresReview||catalog.permits(c.displayRef?[c.displayRef]:undefined,now);
  if (s.stage === 'home') {
    text = 'Культурный план\nПодберём события по дате, составу посетителей и бюджету.';
    rows = [...(s.resumeStage?[[button('Продолжить подбор','resume')]]:[]),[button('Подобрать', 'pick'), button('Мои события', 'saved')], [button('О данных', 'about')]];
  } else if (s.stage === 'city') {
    text = '📍 В каком городе?\nНажмите кнопку или сразу напишите название города.';
    const choices=s.cityOptions?.length?s.cityOptions:catalog.usableCities(now);
    rows=choices.slice(0,6).map(city=>[button(cities[city].name,'city',city)]);
    if(!choices.length)text='Данные по городам сейчас недоступны. Попробуйте позже или откройте «Мои события».';
    rows.push([button('Введите свой город','custom','city')],formNav());
  } else if (s.stage === 'date') {
    text = `📅 На какую дату? · ${cities[s.draft.city!].name}\nВыбрано: ${dateChoice(s.draft)}\n${localTimeNote(s)}\n«Любая дата» — доступные будущие и ещё возможные посещения в загруженной части афиши.`;
    const today=datePlus(now,0,s.draft.city),tomorrow=datePlus(now,1,s.draft.city),short=(d:string)=>d.slice(8,10)+'.'+d.slice(5,7);
    rows = [[button('Сегодня · '+short(today), 'date', today), button('Завтра · '+short(tomorrow), 'date', tomorrow)], [button('Любая дата','anyDate'),button('Другая дата', 'custom', 'date')], formNav()];
  } else if (s.stage === 'time') {
    text = `${dateHeading(s)}\nВо сколько удобно?\n${localTimeNote(s)}`;
    rows = [[button('12:00–18:00', 'time', '12:00-18:00'), button('18:00–22:00', 'time', '18:00-22:00')], [button('Любое время','anyTime'),button('Другое время', 'custom', 'time')], formNav()];
  } else if (s.stage === 'party') {
    const p=s.draft.party!;
    text=`Кто пойдёт?\nПосетители: ${p.adults} взр., ${p.childAges.length} дет.\nВсего до 8 человек, включая хотя бы одного взрослого. Дети — до 17 лет включительно.`;
    rows=[[button('Взрослые −','partyAdjust','adults:-1'),button('Взрослые +','partyAdjust','adults:1')],
      [button('Дети −','partyAdjust','children:-1'),button('Дети +','partyAdjust','children:1')],
      [button('Число взрослых','custom','adults'),button('Число детей','custom','children')],[button('Продолжить','partyDone')],formNav()];
  } else if (s.stage === 'ages') {
    text=`Сколько детям лет? Детей: ${s.draft.party!.childAges.length}.\nВозраст поможет уточнить цену и допуск. Можно не указывать; имена и даты рождения не нужны.`;
    rows=[[button('Указать возраст','custom','ages')],[button('Возраст не указывать','agesUnknown')],formNav()];
  } else if (s.stage === 'budget') {
    text = '💳 Бюджет на вход для всех?\nДорога и дополнительные услуги не включены.';
    rows = [[button('Бесплатно', 'budget', '0'), button('До 500 ₽', 'budget', '500'), button('До 1000 ₽', 'budget', '1000')], [button('Без лимита', 'budget', 'none'), button('Другая сумма', 'custom', 'budget')], formNav()];
  } else if (s.stage === 'interest') {
    text = `Что вам интереснее?\nНачнём с выбранной темы.\nВыбрано: ${themeLabel(s.draft.category)}.`;
    const themes=[button('Любая тема','interest'),...Object.entries(themeLabels).map(([key,label])=>button(label,'interest',key))];
    rows=[themes.slice(0,3),themes.slice(3),formNav()];
  } else if (s.stage === 'input') {
    const i = s.input!;
    const formats:Record<InputField,string> = { city:'Например: Казань или Екатеринбург.',date: `${i.token} ГГГГ-ММ-ДД\nЛюбая действительная дата сегодня или в будущем. Наличие событий на неё проверим отдельно.`, time: `${i.token} ЧЧ:ММ-ЧЧ:ММ\nНапример: ${i.token} 12:35-18:10. Если конец раньше начала — окончание на следующий день; его дата появится в сводке.`, budget: `${i.token} СУММА\nЦелое число от 0 до 99999 рублей.`,
      adults:`${i.token} ЧИСЛО\nВзрослых от 1 до 8; всего до 8 посетителей.`,children:`${i.token} ЧИСЛО\nДетей от 0 до 7; всего до 8 посетителей.`,ages:`${i.token} ${s.draft.party!.childAges.map(()=>'?').join(', ')}\nЗамените ? возрастом 0–17 либо оставьте неизвестным; один возраст на ребёнка.` };
    text = i.field==='city'?`📍 Введите название своего города.\n${formats.city}`:`${i.field==='time'?dateHeading(s)+'\n'+localTimeNote(s)+'\n':i.field==='date'?`📍 ${cities[s.draft.city!].name}\nВыбрано: ${dateChoice(s.draft)}\n`:''}Отправьте одной строкой код и значение:\n${formats[i.field]}`;
    rows = [[button('Назад', 'inputBack'),button('В меню','home')]];
  } else if (s.stage === 'summary') {
    text = `${summary(s)}\nПоказать подходящие события?`; rows = [[button('Показать результаты', 'results')], ...editors(),[button('Назад','back')], home()];
  } else if (s.stage === 'results') {
    const q = makeQuery(s.draft), snapshot=catalog.forCity(q.city),result = select(snapshot, q, new Date(now), config.flowDataMode === 'synthetic-test', s.optIn);
    const denied=snapshot?.mode==='REAL_CATALOG'&&!catalog.usableCities(now).includes(q.city);
    s.cards = [...result.recommendations, ...result.uncertain].map(r => {
      const c=projectCard(catalog,r.resolvedQuery??q as Query,r);
      if('date' in q&&c.occurrence?.kind==='FLEXIBLE_VISIT')c.proposedVisit=true;
      return c;
    }).filter(showCard);
    text = summary(s);
    if(denied)text+='\n\nДанные сейчас недоступны: срок проверки истёк или показ не разрешён. Попробуйте позже.';
    else if (!result.recommendations.length) text += `\n\n${statuses[result.status] ?? 'Подходящих событий не найдено. Измените параметры подбора.'}`;
    if (!denied&&result.catalogIncomplete) text += '\nЗдесь представлена часть афиши города.';
    for (const [i,c] of s.cards.entries()) {
      if(c.displayRef)displayRefs.push(c.displayRef);
      if (i === 0 || s.cards[i-1]!.kind !== c.kind) text += `\n\n${label(c)}:`;
      text += `\n${i + 1}. ${presentationTitle(c)}${alreadySaved(store,event.actor,c)?' · ✅ Сохранено':''}${c.kind === 'UNCERTAIN' ? `\n${compact(c.unknown[0] ?? 'Уточните условия по источнику.',180)}` : ''}`;
      rows.push([button(`Подробнее ${i + 1}`, 'detail', c.identity)]);
    }
    if (!denied&&s.optIn && !result.uncertain.length) text += '\nДругих вариантов для уточнения нет.';
    if (!denied&&!s.optIn) rows.push([button('Показать варианты для проверки', 'uncertain')]);
    rows.push(...editors(),[button('Назад','back')], home()); catalogVersion = catalog.version;
    if (s.cards.length) audience = catalog.snapshot?.mode === 'SYNTHETIC_FIXTURE' ? 'SYNTHETIC' : 'PROVIDER';
  } else if (['detail', 'bookmark', 'delete'].includes(s.stage)) {
    const saved = s.stage !== 'detail' ? findBookmark() : undefined;
    const original: Card | undefined = saved ? JSON.parse(saved.data) : s.stage === 'detail' ? s.cards.find(c => c.identity === s.selected) : undefined;
    const current=saved&&original&&!original.synthetic&&original.displayRef?currentBookmark(original,catalog,now):null;
    const c=current?current.card:original;
    const limitation = current?.notice??(c ? bookmarkLimitation(c, catalog, now) : 'Эта закладка или карточка уже недоступна.');
    if (!original || (s.stage === 'detail' && (original.snapshotVersion !== catalog.version || (original.kind === 'UNCERTAIN' && !s.optIn)))) {
      text = 'Карточка устарела. Выполните подбор заново.'; rows = [[button('Подобрать', 'pick')], home()];
    } else if (!c||!showCard(c)) {
      text=(s.stage==='delete'?'Удалить эту закладку?':current?.notice??'Сведения сейчас недоступны: срок проверки истёк или данные изменились. Попробуйте новый подбор позже.')+
        (saved?'\n'+bookmarkContext(original,false):'');
      rows=s.stage==='delete'?[[button('Да, удалить','confirmRemove'),button('Отмена','cancel')]]:
        [...(saved?[[button('Удалить закладку','remove')],[button('Назад','back')]]:[]),[button('Подобрать','pick')],home()];
    } else {
      audience = c.synthetic ? 'SYNTHETIC' : 'PROVIDER'; catalogVersion = catalog.version;
      if(c.displayRef)displayRefs.push(c.displayRef);
      if(s.stage==='delete') {
        text=`Удалить «${presentationTitle(c,500)}» на ${displayInterval(original.visit?.from??original.query.start,original.visit?.until??original.query.end,original.query.timezone??cities[original.query.city].timezone)} из сохранённого?\n${bookmarkContext(original)}`;
        rows=[[button('Да, удалить','confirmRemove'),button('Отмена','cancel')]];
      } else {
      const savedView=s.stage==='bookmark',from=original.visit?.from??original.query.start,until=original.visit?.until??original.query.end;
      const repeatVisit=!savedView||c.visit?.from!==from||c.visit?.until!==until;
      const ages=original.query.party?.childAges??[];
      const savedContext=savedView?`${cities[original.query.city].name} · ${original.query.party?.adults??1} взр., ${ages.length} дет.${ages.length?' · возраст: '+ages.map(a=>a===null?'?':a).join(', '):''} · бюджет ${original.query.budgetRub===null?'без лимита':original.query.budgetRub+' ₽'} (${original.query.budgetBasis==='PARTY_TOTAL'?'на всех':'на одного взрослого'})\nВыбрано: ${displayInterval(from,until,original.query.timezone??cities[original.query.city].timezone)}\n`:'';
      text = `${presentationTitle(c)}\n${savedView?'Сохранено · ':''}${label(c)}\n${savedContext}${limitation ? `${limitation}\n` : ''}`;
      if(s.conditionPage!==undefined) {
        const pages=cardPages(c,now,!savedView,repeatVisit), page=Math.max(0,Math.min(s.conditionPage,pages.length-1));
        text+=`Условия посещения · ${page+1}/${pages.length}\n${pages[page]}`;
        rows.push([...(page>0?[button('Ранее условия','conditions',String(page-1))]:[]),...(page+1<pages.length?[button('Далее условия','conditions',String(page+1))]:[])]);
        rows.push([button('К карточке','conditionOverview')]);
      } else {text+=cardOverview(c,now,!savedView,repeatVisit);rows.push([button('Условия посещения','conditions')]);}
      for(const link of [c.source,...(c.visit?.links??[])]) if (safeLink(link.url) && link.url.length <= 2048) rows.push([{ type: 'link', text: compact(link.label,80), url: link.url }]);
      const isSaved=s.stage==='detail'?alreadySaved(store,event.actor,c):undefined;
      rows.push(s.stage === 'detail' ? [isSaved?button('✅ Сохранено','bookmark',JSON.stringify({identity:isSaved.identity,generation:isSaved.generation})):button('Сохранить','save'), button('К результатам', 'results')]
        : [button('Удалить закладку', 'remove'),button('Назад','back')]);
      rows.push(home());
      }
    }
  } else if (s.stage === 'saved') {
    const total=(store.db.prepare('SELECT count(*) n FROM bookmarks WHERE actor=?').get(event.actor) as {n:number}).n;
    s.page=Math.max(0,Math.min(Math.floor(s.page)||0,Math.floor(Math.max(0,total-1)/5)));
    const saved = store.db.prepare('SELECT * FROM bookmarks WHERE actor=? ORDER BY saved_at DESC, identity LIMIT 6 OFFSET ?').all(event.actor, s.page * 5) as Bookmark[];
    text = 'Мои события';
    if (!saved.length) text += '\nЗакладок пока нет.';
    for (const [i,b] of saved.slice(0,5).entries()) {
      const original:Card=JSON.parse(b.data),current=!original.synthetic&&original.displayRef?currentBookmark(original,catalog,now):null;
      const c=current?current.card:original,visible=Boolean(c&&showCard(c)); text += `\n${s.page * 5 + i + 1}. ${visible?presentationTitle(c!):'Сохранённая запись · сведения сейчас недоступны'}`;
      text+=`\n${bookmarkContext(original,visible)}${visible?(current?.changed.length?' · условия изменились':current?.assessment==='EXPIRED'?' · дата прошла':c!.kind==='UNCERTAIN'?' · нужно уточнить условия':''):''}`;
      const expired=now>=Date.parse(original.visit?.until??original.query.end);
      if(expired&&current?.assessment!=='EXPIRED')text+=' · дата прошла';
      text+='\n💰 '+(visible?(!current&&!c!.synthetic?'При сохранении: ':'')+cardPrice(c!):'Общая стоимость не указана — сведения сейчас недоступны');
      const ref=JSON.stringify({ identity: b.identity, generation: b.generation }),number=s.page*5+i+1;
      rows.push([button(`Открыть ${number}`, 'bookmark',ref),button(`Удалить ${number}`,'remove',ref)]);
      if(visible&&c) {if (!c.synthetic) audience = 'PROVIDER'; else audience ??= 'SYNTHETIC';
      if(c.displayRef)displayRefs.push(c.displayRef);else if(!c.synthetic)displayRefs.push({snapshotHash:'',eventId:c.eventId});}
    }
    if (s.page > 0) rows.push([button('Предыдущие', 'saved', String(s.page - 1))]);
    if (saved.length > 5) rows.push([button('Следующие', 'saved', String(s.page + 1))]);
    rows.push([button('Назад','back'),button('Главная', 'home')]); catalogVersion = catalog.version;
  } else if(s.stage==='leave') {
    text='Это событие ещё не сохранено. Сохранить перед переходом?';
    rows=[[button('Сохранить и перейти','saveAndLeave'),button('Остаться','stay')]];
    if(s.leave?.failed)rows.push([button('Отменить выбор и перейти','discardAndLeave')]);
  } else if (s.stage === 'erase') {
    text = 'Удалить все ваши закладки и параметры, включая состав и возраст детей?\nИстория чата MAX и старые резервные копии останутся.'; rows = [[button('Да, удалить', 'confirmErase'),button('Отмена', 'cancel')]];
  } else {
    text = config.flowDataMode==='synthetic-test'?'О данных\nЗдесь вымышленные события для проверки интерфейса.':`О данных\nЗдесь часть афиши учреждений Казани и Екатеринбурга. Минимальные факты, дата получения и ссылка на источник — в карточке.${config.admissionMode==='PUBLIC'?'':' Доступ ограничен тестовым режимом.'}`;
    text+='\nСведения могут измениться. Билеты и допуск уточняйте у источника; неизвестная цена не означает бесплатный вход.\nДо 50 закладок хранятся до удаления, параметры и возраст детей — 30 дней без активности. Кнопки действуют 15 минут.\nУдалить закладки и параметры: /delete_data.';
    rows = [[button('Удалить мои данные','erase')],[button('Назад','back')],home()];
  }
  if ((config.mode === 'live'||catalog.requiresReview) && !deliveryAllowed({method:'messages',recipient:event.actor,body:{text},audience,displayRefs},config,catalog,now)) {
    text = 'Эти сведения сейчас недоступны для показа. Попробуйте позже или откройте «Мои события».';
    rows = [home()]; audience = undefined; catalogVersion = undefined;
  }
  if (config.flowDataMode === 'synthetic-test') {text = `🧪 Демо · событие вымышленное\n${text}`;audience??='SYNTHETIC';}
  if (s.notice) text = `${s.notice}\n\n${text}`;
  store.db.prepare('INSERT INTO flow_states(actor,revision,event_ts,updated_at,data) VALUES(?,?,?,?,?) ON CONFLICT(actor) DO UPDATE SET revision=excluded.revision,event_ts=excluded.event_ts,updated_at=excluded.updated_at,data=excluded.data')
    .run(event.actor, revision, event.timestamp, now, JSON.stringify(s));
  if(text.length>3950) throw new Error('FLOW_SCREEN_LENGTH');
  const screen=desireScreen(store,event.actor,store.contact(event.actor)!.chat,revision,s.stage,event.kind,now);
  store.enqueue(`${event.key}:screen`, event.actor, null, 'culture_screen', { method: 'messages', recipient: event.actor, audience,displayRefs,screen,
    body: { text, notify: false, attachments: rows.length?[{ type: 'inline_keyboard', payload: { buttons: rows.filter(row=>row.length) } }]:[] } }, now, now + 60000, { revision, catalogVersion });
  return valid ? saveOutcome??'FLOW_ACCEPTED' : 'FLOW_INVALID_INPUT';
}
