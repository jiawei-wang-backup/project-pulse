import { randomUUID } from 'node:crypto';

export async function lookupGitHubUser(login) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(login)) {
    throw new Error('Provide a GitHub username.');
  }
  const response = await fetch('https://api.github.com/users/' + encodeURIComponent(login), {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('GitHub user lookup failed: ' + response.status);
  const user = await response.json();
  if (user.type !== 'User' || !Number.isSafeInteger(user.id) || user.id <= 0 ||
      typeof user.login !== 'string' || !user.login.trim()) {
    throw new Error('GitHub did not return a personal user account.');
  }
  return user;
}

// Called inside the device enrollment transaction.
export async function resolveGitHubDeveloper(db, user, existingDeveloperId) {
  await db.query('SELECT pg_advisory_xact_lock($1::bigint)', [user.id]);
  const { rows: [identity] } = await db.query(
    'SELECT developer_id FROM github_identities WHERE github_user_id=$1', [user.id]);
  if (identity && existingDeveloperId && identity.developer_id !== existingDeveloperId.toLowerCase()) {
    throw new Error('GitHub account is already bound to another team member.');
  }

  const developerId = identity?.developer_id ?? existingDeveloperId ?? randomUUID();
  if (!identity && !existingDeveloperId) {
    await db.query('INSERT INTO developers (developer_id, display_name) VALUES ($1,$2)',
      [developerId, user.name?.trim() || user.login]);
  }
  try {
    await db.query(`INSERT INTO github_identities (github_user_id, developer_id, github_login)
      VALUES ($1,$2,$3) ON CONFLICT (github_user_id) DO UPDATE SET github_login=EXCLUDED.github_login`,
      [user.id, developerId, user.login]);
  } catch (error) {
    if (error.code === '23505') throw new Error('Team member is already bound to another GitHub account.');
    if (error.code === '23503') throw new Error('Team member UUID does not exist.');
    throw error;
  }
  return developerId;
}
