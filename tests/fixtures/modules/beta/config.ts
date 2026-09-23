import { configSection } from '../../../../src/core/define.js';

export default configSection({
  build: (g) => g.addSubcommand((s) => s.setName('show').setDescription('Show beta settings.')),
  async run() {},
});
