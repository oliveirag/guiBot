import { routes } from '../../../core/define.js';
import { acceptRawJson } from '../../../core/http.js';
import { normalizeJira } from '../lib/jira.js';
import { webhookHandler } from '../lib/webhook.js';

export default routes(async (app, { env, log }) => {
  acceptRawJson(app);
  app.post(
    '/webhooks/jira',
    webhookHandler(
      {
        source: 'jira',
        secret: env.jiraWebhookSecret,
        signatureHeader: 'x-hub-signature',
        deliveryHeader: 'x-atlassian-webhook-identifier',
        normalize: (payload) => normalizeJira(payload),
      },
      log,
    ),
  );
});
