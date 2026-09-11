import { execFileSync } from 'node:child_process';

const port = process.env.JSDESIGN_MCP_PORT || '3847';

function listenPids() {
  try {
    return execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const first = listenPids();
if (first.length === 0) {
  console.error(`[jsdesign-mcp] nothing listening on ${port}`);
  process.exit(0);
}

for (const pid of first) {
  process.kill(Number(pid), 'SIGTERM');
  console.error(`[jsdesign-mcp] sent SIGTERM to pid ${pid} on port ${port}`);
}

const deadline = Date.now() + 1500;
while (Date.now() < deadline && listenPids().length > 0) {
  await sleep(50);
}

for (const pid of listenPids()) {
  process.kill(Number(pid), 'SIGKILL');
  console.error(`[jsdesign-mcp] sent SIGKILL to pid ${pid} on port ${port}`);
}

if (listenPids().length > 0) {
  console.error(`[jsdesign-mcp] port ${port} still in use`);
  process.exit(1);
}
