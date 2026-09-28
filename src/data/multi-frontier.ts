import { sources, type Institution } from './source-registry.js';
// Только конечные поверхности учреждений, не универсальный веб-обход.
export const entryPaths:Partial<Record<Institution,string[]>>={
 'kazan-kremlin':['/','/exhibitions','/events','/museums/vystavochnye-zaly-prisutstvennyh-mest','/museums/muzej-istorii-blagoveshhenskogo-sobora'],
 mie:['/','/exhibitions','/mie-filial'],tatmuseum:['/events/','/visitors/','/visitors/tickets/'],uralopera:['/','/contacts'],sgaf:['/','/contacts','/festivals','/terms/purchase','/terms/concertrules'],
 'spb-philharmonia':['/afisha/','/about/roadmap/'], 'spb-opera':['/afisha/','/contacts/','/afisha/prices_and_categories/'],
 novat:['/afisha/performances/','/theatre/contacts/','/buy_now/purchase_rules/'],operann:['/afisha','/kontakty'],
 'samara-opera':['/afisha/','/Kontaktnaya_informatsiya/','/bilety/'],permopera:['/playbills/playbill/','/about/contacts/'],
 'chel-philharmonia':['/afisha/','/viewers/contacts/'],bashopera:['/affiche/','/about/contacts/'],krasfil:['/events','/contacts','/nasi-zaly','/bolsoj-zal','/malyj-zal','/kamernyj-zal','/organnyj-zal','/zal-torzestv'],
 filarm:['/afisha/','/contacts/'],meloman:['/concert/','/slushatelyam/contacts/','/hall/'],mosconcert:['/'],
 'spb-museum':['/','/themuseum/kontakty.php','/exhibits_and_exhibitions/temporary_exhibitions/','/exhibits_and_exhibitions/permanent_displays/'],
 'spb-library':['/','/events/'],'nsk-museum':['/'],'nsk-library':['/','/afisha/events/','/about/contacts/'],
 'nn-art':['/','/vystavki/','/postoyannye-expozitzii/','/posetitelyam/stoimost-lgoty/'],'nn-library':['/','/?page_id=84'],
 'samara-museum':['/'],'samara-library':['/','/afisha'],
 'perm-museum':['/','/afisha','/branches'],'perm-library':['/','/events/afisha/?dateMonth','/events/exhibitions/?dateMonth','/about/contacts/'],
 'chel-museum':['/','/exhibitions/','/contacts/'],
 'chel-library':['/ru/','/ru/events/','/ru/pages/about/lib/contacts/'],
};
export const sourceEntries=(id:Institution)=>(entryPaths[id]??[]).map(path=>sources[id].origin+path);
