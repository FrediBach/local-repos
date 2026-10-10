import './mcp-connection-help.css'

const policyExample = JSON.stringify({
  enabled: true,
  roots: ['/absolute/path/to/projects'],
  clients: [{
    id: 'my-assistant',
    token: 'REPLACE_WITH_YOUR_GENERATED_TOKEN',
    roots: ['/absolute/path/to/projects'],
    capabilities: ['read', 'discovery', 'git'],
    disclosePaths: false,
    discloseContent: true,
  }],
}, null, 2)

export function McpConnectionHelp() {
  return <details className="mcp-help">
    <summary>Connect an AI assistant with MCP</summary>
    <div className="mcp-help-body">
      <p>MCP lets an assistant discover your projects, read cached reports and README content, and inspect local Git history. It is off by default and runs on your computer through the local helper. The hosted app and browser folder access cannot provide an MCP server.</p>
      <ol>
        <li>
          <h3>Create a private configuration</h3>
          <p>Use Node.js 22.12 or newer and an installed Local Repos checkout (<code>npm ci</code>). In a macOS or Linux terminal, create a configuration directory outside every folder you will scan, then generate a token:</p>
          <pre><code>{`mkdir -p "$HOME/.config/local-repos"
chmod 700 "$HOME/.config/local-repos"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`}</code></pre>
          <p>Save the JSON below as <code>~/.config/local-repos/mcp.json</code>. Replace both project paths with the same absolute directory path, and replace the token placeholder with the generated value. Keep the token private; use a separate token for each client.</p>
          <pre><code>{policyExample}</code></pre>
          <pre><code>{'chmod 600 "$HOME/.config/local-repos/mcp.json"'}</code></pre>
          <p>This profile permits reads, metadata scans, and local Git queries. README and log content may contain secrets; set <code>discloseContent</code> to <code>false</code> to withhold content reads. Fresh checks and development controls require additional grants.</p>
        </li>
        <li>
          <h3>Start the helper with MCP enabled</h3>
          <p>From the Local Repos checkout, run:</p>
          <pre><code>{'LOCAL_REPOS_MCP_CONFIG="$HOME/.config/local-repos/mcp.json" npm run helper'}</code></pre>
          <p>Use <code>npm run app</code> instead of <code>npm run helper</code> in that command to start the browser app too, after building it with <code>npm run build</code>. Stop an existing helper first to free port 4318. Restart the helper whenever you change or revoke client credentials.</p>
        </li>
        <li>
          <h3>Connect your MCP client</h3>
          <p><strong>HTTP:</strong> add a server in your client’s MCP settings with URL <code>http://127.0.0.1:4318/mcp</code> and header <code>Authorization: Bearer YOUR_TOKEN</code>, using the same token as the helper configuration. The client must support custom bearer headers; OAuth discovery is not available.</p>
          <p><strong>Stdio:</strong> for a command-based client, save this separate file as <code>~/.config/local-repos/mcp-client.json</code>, replacing the token:</p>
          <pre><code>{JSON.stringify({ url: 'http://127.0.0.1:4318/mcp', token: 'YOUR_TOKEN' }, null, 2)}</code></pre>
          <pre><code>{'chmod 600 "$HOME/.config/local-repos/mcp-client.json"'}</code></pre>
          <p>Configure the client to launch the bridge with these settings. Replace paths with absolute paths; client settings may not expand <code>~</code> or <code>$HOME</code>.</p>
          <dl>
            <dt>Command</dt><dd><code>npm</code></dd>
            <dt>Arguments</dt><dd><code>--silent mcp:stdio</code> (two arguments)</dd>
            <dt>Working directory</dt><dd>Your Local Repos checkout</dd>
            <dt>Environment variable</dt><dd><code>LOCAL_REPOS_MCP_CLIENT_CONFIG</code> = absolute path to <code>mcp-client.json</code></dd>
          </dl>
          <p>The helper must stay running. The bridge connects to it without starting another helper. Keep <code>--silent</code> so npm’s banner does not interfere with the protocol. Client settings vary; HTTP and stdio are tested with the official SDK, but external host applications remain unverified.</p>
        </li>
        <li>
          <h3>Discover your projects</h3>
          <p>Ask your assistant to list Local Repos roots, scan one configured root, and list its projects. The tools are <code>local_repos_list_roots</code>, <code>local_repos_scan_root</code>, and <code>local_repos_list_projects</code>. Scans need a returned root ID and a unique <code>requestId</code>; poll <code>local_repos_get_operation</code> until complete.</p>
          <p>Rescan after a helper restart. Cached report reads never run checks, and MCP cannot read the browser’s saved reports, favorites, or tags.</p>
        </li>
      </ol>
      <p><strong>Connection trouble?</strong> Check that the helper started with the configuration environment variable, both tokens match, and configuration files have owner-only permissions. Check the helper terminal for startup errors. A client that cannot send HTTP headers can use the stdio bridge.</p>
    </div>
  </details>
}
