const git = require('isomorphic-git');
const fs = require('fs');
const dir = process.cwd();
(async () => {
  const status = await git.statusMatrix({ fs, dir });
  for (const [filepath, head, worktree, stage] of status) {
    if (worktree !== 0 && filepath !== 'data/judu.sqlite') await git.add({ fs, dir, filepath });
  }
  const sha = await git.commit({ fs, dir, author: { name: 'Codex', email: 'codex@local' }, message: `feat(web): 完成第一阶段深度阅读器基础能力

开发详情：完成桌面阅读器、书架、EPUB/PDF/TXT 导入、句读 API、SQLite 持久化和 Codex 风格 UI。

测试：单元测试 + 构建检查
- 单元测试：npm test
- 静态检查：npm run lint
- 构建检查：npm run build

被否决：暂不加入个人笔记、问题箱、语音和向量检索。
决策：先验证原文阅读到句读结果的最小闭环。

Task: TASK-001
Assisted-by: Codex` });
  console.log(sha);
})();
