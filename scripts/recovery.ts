import { backupDatabase, restoreDatabase, discardRestoredPersonalization } from '../src/recovery.js';

// Не загружает .env и credentials. Идентичность задаётся оператором явно.
async function main() {
  const [command,mode,botId,source,target]=process.argv.slice(2);
  if(!['local','live'].includes(mode??'')||!botId||!/^\d{1,19}$/.test(botId)||!source||!target||process.argv.length!==7) throw Error('RECOVERY_ARGUMENTS');
  const identity={mode:mode as 'local'|'live',botId};
  const receipt=command==='backup'?await backupDatabase(source,target,identity)
    :command==='restore'?await restoreDatabase(source,target,identity)
    :command==='discard'?discardRestoredPersonalization(source,identity,target):null;
  if(!receipt) throw Error('RECOVERY_COMMAND');console.log(JSON.stringify(receipt));
}
main().catch(e=>{console.error(JSON.stringify({result:'FAILED',errorClass:e instanceof Error&&/^RECOVERY_[A-Z_]+$/.test(e.message)?e.message:'RECOVERY_STORAGE_FAILURE'}));process.exitCode=1;});
