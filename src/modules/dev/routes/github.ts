import { routes } from '../../../core/define.js';
import { acceptRawJson } from '../../../core/http.js';
import { normalizeGithub } from '../lib/github.js';
import { webhookHandler } from '../lib/webhook.js';

export default routes(async (app, { env, log }) => {
  acceptRawJson(app);
  app.post(
    '/webhooks/github',
    webhookHandler(
      {
        source: 'github',
        secret: env.githubWebhookSecret,
        signatureHeader: 'x-hub-signature-256',
        deliveryHeader: 'x-github-delivery',
        normalize: (payload, request) => {
          const event = request.headers['x-github-event'];
          if (typeof event !== 'string' || event === 'ping') return null;
          return normalizeGithub(event, payload);
        },
      },
      log,
    ),
  );
});
