import { Command } from 'commander'
import pc from 'picocolors'
import { loginCommand, logoutCommand, whoamiCommand } from './commands/auth.js'
import { historyCommand } from './commands/history.js'
import { pushCommand } from './commands/push.js'
import { uiCommand } from './commands/serve.js'
import { deployCommand } from './commands/deploy.js'
import { undoCommand } from './commands/undo.js'
import { updateCommand } from './commands/update.js'
import { watchCommand } from './commands/watch.js'
import { isSeaBinary } from './core/sea.js'
import { VERSION } from './server/index.js'

const program = new Command()
program
  .name('gitdrop')
  .description('Drop your project. Push to GitHub. 🪂')
  .version(VERSION, '-v, --version')
  .showHelpAfterError()

for (const cmd of [pushCommand, updateCommand, watchCommand, undoCommand, deployCommand, loginCommand, logoutCommand, whoamiCommand, uiCommand, historyCommand]) {
  program.addCommand(cmd)
}

// Double-clicking the standalone binary (no arguments) opens the web UI.
if (process.argv.length <= 2 && isSeaBinary()) process.argv.push('ui')

program.parseAsync(process.argv).catch((e: unknown) => {
  const name = (e as { name?: string })?.name
  if (name === 'ExitPromptError') {
    console.log('\nAnnulé.')
    process.exit(130)
  }
  console.error(`${pc.red('✖')} ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
