import { assertNavigable, isNavigable, UrlRejectedError } from './urlGuard';

afterEach(() => {
  delete process.env.LIVE_URL_ALLOWLIST;
});

describe('assertNavigable — scheme allowlist (SEC-10)', () => {
  it('accepts http:// and https://', () => {
    expect(assertNavigable('http://localhost:8081/').protocol).toBe('http:');
    expect(assertNavigable('https://stage.example.com/app').protocol).toBe('https:');
  });

  it('accepts about:blank as the pane initial state', () => {
    expect(assertNavigable('about:blank').href).toBe('about:blank');
  });

  it('rejects file:// — the secret-exfiltration path for backend/.env (SEC-01/SEC-10)', () => {
    expect(() =>
      assertNavigable('file:///C:/Projects/visual-regression-tool/backend/.env')
    ).toThrow(UrlRejectedError);
  });

  it.each([
    ['data:', 'data:text/html,<h1>hi</h1>'],
    ['javascript:', 'javascript:alert(document.cookie)'],
    ['chrome:', 'chrome://settings'],
    ['view-source:', 'view-source:http://localhost:8081/'],
    ['devtools:', 'devtools://devtools/bundled/inspector.html'],
    ['blob:', 'blob:http://localhost/1234'],
    ['about: (non-blank)', 'about:config'],
  ])('rejects %s', (_label, url) => {
    expect(() => assertNavigable(url)).toThrow(/not permitted|not a valid/i);
  });

  it('rejects empty and non-string input with an actionable message (NFR-09)', () => {
    expect(() => assertNavigable('')).toThrow(/URL is required/i);
    expect(() => assertNavigable(undefined)).toThrow(/URL is required/i);
    expect(() => assertNavigable('stage.example.com')).toThrow(/Include the scheme/i);
  });
});

describe('assertNavigable — cloud metadata denylist (SEC-10)', () => {
  it('rejects the AWS/Azure IMDS address', () => {
    expect(() => assertNavigable('http://169.254.169.254/latest/meta-data/')).toThrow(
      /metadata/i
    );
  });

  it('rejects any 169.254.0.0/16 link-local address', () => {
    expect(() => assertNavigable('http://169.254.170.2/v2/credentials')).toThrow(/metadata/i);
  });

  it('rejects metadata.google.internal', () => {
    expect(() =>
      assertNavigable('http://metadata.google.internal/computeMetadata/v1/')
    ).toThrow(/metadata/i);
  });

  it('accepts RFC1918 hosts — staging deliberately lives there', () => {
    expect(assertNavigable('http://192.168.1.50:4200').hostname).toBe('192.168.1.50');
    expect(assertNavigable('http://10.0.0.8/app').hostname).toBe('10.0.0.8');
    expect(assertNavigable('http://172.16.4.4:8080/').hostname).toBe('172.16.4.4');
  });
});

describe('assertNavigable — LIVE_URL_ALLOWLIST (SEC-10)', () => {
  it('accepts a matching host glob and rejects everything else', () => {
    process.env.LIVE_URL_ALLOWLIST = '*.stage.corp';
    expect(assertNavigable('https://app.stage.corp/login').hostname).toBe('app.stage.corp');
    expect(() => assertNavigable('https://evil.example.com/')).toThrow(/allowlist/i);
  });

  it('supports several comma-separated globs', () => {
    process.env.LIVE_URL_ALLOWLIST = '*.stage.corp, *.dev.corp ,localhost';
    expect(isNavigable('https://a.dev.corp/')).toBe(true);
    expect(isNavigable('http://localhost:8081/')).toBe(true);
    expect(isNavigable('https://elsewhere.net/')).toBe(false);
  });

  it('treats an empty allowlist as "any http(s) host"', () => {
    process.env.LIVE_URL_ALLOWLIST = '';
    expect(isNavigable('https://anything.example.com/')).toBe(true);
  });

  it('is read at call time, not at module load (CLAUDE.md gotcha #1)', () => {
    expect(isNavigable('https://late.stage.corp/')).toBe(true);
    process.env.LIVE_URL_ALLOWLIST = '*.other.corp';
    expect(isNavigable('https://late.stage.corp/')).toBe(false);
  });

  it('does not let a glob metacharacter in the allowlist match arbitrary hosts', () => {
    process.env.LIVE_URL_ALLOWLIST = 'stage.corp';
    // '.' must be literal — "stageXcorp" must not match.
    expect(isNavigable('https://stageXcorp/')).toBe(false);
    expect(isNavigable('https://stage.corp/')).toBe(true);
  });
});
