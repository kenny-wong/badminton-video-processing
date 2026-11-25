// The connection to the enrolment planner, which shows the YouTube links (lib/planner.js).
// GET /api/planner: whether it is connected, to which account, what was sent and what couldn't be.
// POST /api/planner { code }: connects with the code the planner made, and sends every link.
// POST /api/planner/send: looks every match up again and sends every link.
// DELETE /api/planner: forgets the connection (links already sent stay there).

import { fail, json, readJson } from '../lib/http.js';
import { connect, connection, disconnect, sendLinks, status } from '../lib/planner.js';

const refused = (err) => fail(err.code === 'badCode' ? 400 : 502, err.code ?? 'planner', err.message);

export const onRequestGet = ({ app }) => json(status(app));

export async function onRequestPost({ request, app }) {
  try {
    await connect(app, (await readJson(request))?.code);
  } catch (err) {
    return refused(err);
  }
  await sendLinks(app, { all: true }).catch(() => {}); // connected all the same; what went wrong is in the status
  return json(status(app));
}

export async function send({ app }) {
  if (!connection(app.dataDir)) return fail(409, 'notConnected', 'Connect to the planner first');
  try {
    await sendLinks(app, { all: true });
  } catch (err) {
    return refused(err);
  }
  return json(status(app));
}

export async function onRequestDelete({ app }) {
  await disconnect(app);
  return json(status(app));
}
