import { spawn } from 'node:child_process'
import pc from 'picocolors'

export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  private i = 0
  private timer: NodeJS.Timeout | null = null
  private text = ''
  private tty = !!process.stdout.isTTY

  start(text: string): void {
    this.text = text
    if (!this.tty) {
      console.log(`… ${text}`)
      return
    }
    this.stopTimer()
    this.timer = setInterval(() => this.render(), 80)
    this.render()
  }

  update(text: string): void {
    this.text = text
  }

  succeed(text = this.text): void {
    this.finish(pc.green('✔'), text)
  }

  fail(text = this.text): void {
    this.finish(pc.red('✖'), text)
  }

  stop(): void {
    this.stopTimer()
    if (this.tty) process.stdout.write('\r\x1b[K')
  }

  private render(): void {
    process.stdout.write(`\r\x1b[K${pc.cyan(this.frames[this.i++ % this.frames.length])} ${this.text}`)
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private finish(symbol: string, text: string): void {
    this.stopTimer()
    if (this.tty) process.stdout.write('\r\x1b[K')
    console.log(`${symbol} ${text}`)
  }
}

export const log = {
  info: (m: string) => console.log(`${pc.cyan('ℹ')} ${m}`),
  ok: (m: string) => console.log(`${pc.green('✔')} ${m}`),
  warn: (m: string) => console.log(`${pc.yellow('⚠')} ${m}`),
  error: (m: string) => console.error(`${pc.red('✖')} ${m}`),
  dim: (m: string) => console.log(pc.dim(m)),
}

export const formatBytes = (n: number): string =>
  n < 1024 ? `${n} o` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1024 ** 2).toFixed(1)} Mo`

export const isInteractive = (): boolean => !!process.stdin.isTTY && !!process.stdout.isTTY

export function openBrowser(url: string): void {
  try {
    const [cmd, args] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
          : ['xdg-open', [url]]
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref()
  } catch {
    // The URL is printed anyway.
  }
}
