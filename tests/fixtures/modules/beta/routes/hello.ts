import { routes } from '../../../../../src/core/define.js';

export default routes(async (app) => {
  app.get('/hello', async () => ({ hi: true }));
});
