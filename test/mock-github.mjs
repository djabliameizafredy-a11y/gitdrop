// Tiny fake GitHub (REST + Device Flow) backed by real bare git repositories.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

export const TOKEN = 'ghp_' + 'a'.repeat(36)
const USER = { id: 42, login: 'tester', name: 'Test User', avatar_url: 'http://localhost/a.png' }

export async function startMock(remotesDir) {
  const repos = new Set()
  const priv = new Map()
  const pages = new Set()
  const calls = []
  let devicePolls = 0
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      const url = new URL(req.url, 'http://x')
      const authed = req.headers.authorization === `Bearer ${TOKEN}`
      let parsed = null
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        parsed = raw
      }
      calls.push({ method: req.method, path: url.pathname, body: parsed })

      if (url.pathname === '/login/device/code') {
        return json(res, 200, {
          device_code: 'dev123',
          user_code: 'ABCD-1234',
          verification_uri: 'http://localhost/login/device',
          interval: 1,
          expires_in: 60,
        })
      }
      if (url.pathname === '/login/oauth/access_token') {
        devicePolls++
        return json(res, 200, devicePolls < 2 ? { error: 'authorization_pending' } : { access_token: TOKEN })
      }
      if (!authed) return json(res, 401, { message: 'Bad credentials' })

      if (req.method === 'GET' && url.pathname === '/user') {
        return json(res, 200, USER, { 'x-oauth-scopes': 'repo, workflow' })
      }
      if (req.method === 'POST' && url.pathname === '/user/repos') {
        const body = JSON.parse(raw)
        if (repos.has(body.name)) {
          return json(res, 422, {
            message: 'Repository creation failed.',
            errors: [{ message: 'name already exists on this account' }],
          })
        }
        repos.add(body.name)
        priv.set(body.name, !!body.private)
        const dir = path.join(remotesDir, USER.login, `${body.name}.git`)
        mkdirSync(path.dirname(dir), { recursive: true })
        execFileSync('git', ['init', '--bare', '-b', 'main', dir], { stdio: 'ignore' })
        return json(res, 201, {
          full_name: `${USER.login}/${body.name}`,
          html_url: `https://github.com/${USER.login}/${body.name}`,
          private: body.private,
        })
      }
      const m = /^\/repos\/tester\/([^/]+)\/commits$/.exec(url.pathname)
      if (req.method === 'GET' && m) {
        if (!repos.has(m[1])) return json(res, 404, { message: 'Not Found' })
        const dir = path.join(remotesDir, USER.login, `${m[1]}.git`)
        try {
          execFileSync('git', ['-C', dir, 'rev-parse', '--verify', 'main'], { stdio: 'ignore' })
          return json(res, 200, [{}])
        } catch {
          return json(res, 409, { message: 'Git Repository is empty.' })
        }
      }
      const pg = /^\/repos\/tester\/([^/]+)\/pages$/.exec(url.pathname)
      if (pg && req.method === 'POST') {
        if (priv.get(pg[1])) return json(res, 403, { message: 'Your current plan does not support GitHub Pages for this repository.' })
        if (pages.has(pg[1])) return json(res, 409, { message: 'A GitHub Pages site already exists.' })
        pages.add(pg[1])
        return json(res, 201, { html_url: `https://tester.github.io/${pg[1]}/` })
      }
      const tp = /^\/repos\/tester\/([^/]+)\/topics$/.exec(url.pathname)
      if (tp && req.method === 'PUT') return json(res, 200, { names: JSON.parse(raw).names })
      const pr = /^\/repos\/tester\/([^/]+)\/pulls$/.exec(url.pathname)
      if (pr && req.method === 'POST') {
        return json(res, 201, { html_url: `https://github.com/tester/${pr[1]}/pull/1`, number: 1 })
      }
      const rp = /^\/repos\/tester\/([^/]+)$/.exec(url.pathname)
      if (rp && req.method === 'GET' && repos.has(rp[1])) {
        return json(res, 200, { full_name: `tester/${rp[1]}`, default_branch: 'main' })
      }
      json(res, 404, { message: 'Not Found' })
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url,
    calls,
    precreate(name) {
      repos.add(name)
      const dir = path.join(remotesDir, USER.login, `${name}.git`)
      mkdirSync(path.dirname(dir), { recursive: true })
      execFileSync('git', ['init', '--bare', '-b', 'main', dir], { stdio: 'ignore' })
    },
    close: () => new Promise((r) => server.close(r)),
  }
}
