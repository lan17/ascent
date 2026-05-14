// Slack connector access via Replit connector proxy (no SDK; SDK is firewalled).
// Mirrors what @replit/connectors-sdk does under the hood.

let cached: { token: string; expiresAt: number } | null = null;

async function getSlackAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  if (!hostname) throw new Error("REPLIT_CONNECTORS_HOSTNAME not set");

  const xReplitToken =
    process.env["REPL_IDENTITY"] != null
      ? "repl " + process.env["REPL_IDENTITY"]
      : process.env["WEB_REPL_RENEWAL"] != null
        ? "depl " + process.env["WEB_REPL_RENEWAL"]
        : null;
  if (!xReplitToken) throw new Error("No REPL_IDENTITY or WEB_REPL_RENEWAL set");

  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=slack`,
    { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } },
  );
  if (!res.ok) throw new Error(`connector lookup failed: ${res.status}`);
  const body = (await res.json()) as {
    items?: Array<{
      settings?: { access_token?: string; expires_at?: string; oauth?: { credentials?: { access_token?: string; expires_at?: string } } };
    }>;
  };
  const item = body.items?.[0];
  const settings = item?.settings;
  const token =
    settings?.access_token ?? settings?.oauth?.credentials?.access_token;
  if (!token) throw new Error("Slack connection has no access token");
  const expIso = settings?.expires_at ?? settings?.oauth?.credentials?.expires_at;
  const expiresAt = expIso ? new Date(expIso).getTime() : Date.now() + 30 * 60_000;
  cached = { token, expiresAt };
  return token;
}

export type SlackFace = { id: string; name: string; image: string };

export async function fetchSlackFaces(limit = 32): Promise<SlackFace[]> {
  const token = await getSlackAccessToken();
  const res = await fetch("https://slack.com/api/users.list?limit=200", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`slack users.list http ${res.status}`);
  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    members?: Array<{
      id: string;
      deleted?: boolean;
      is_bot?: boolean;
      profile?: {
        display_name?: string;
        real_name?: string;
        image_192?: string;
        image_512?: string;
        image_72?: string;
      };
    }>;
  };
  if (!body.ok) throw new Error(`slack: ${body.error ?? "unknown"}`);
  const faces: SlackFace[] = [];
  for (const m of body.members ?? []) {
    if (m.deleted || m.is_bot || m.id === "USLACKBOT") continue;
    const img = m.profile?.image_192 ?? m.profile?.image_512 ?? m.profile?.image_72;
    if (!img) continue;
    faces.push({
      id: m.id,
      name: m.profile?.display_name || m.profile?.real_name || m.id,
      image: img,
    });
    if (faces.length >= limit) break;
  }
  return faces;
}
