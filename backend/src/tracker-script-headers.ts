export function applyTrackerScriptHeaders(
  request: { path: string },
  response: { setHeader: (name: string, value: string) => void },
) {
  if (request.path === '/track/v1.js') {
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('Access-Control-Allow-Origin', '*');
  }
}
