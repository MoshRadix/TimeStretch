const { spawnSync } = require('node:child_process');
const { version } = require('../package.json');

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result;
}

function main() {
  const tag = `v${version}`;
  if (runGit(['branch', '--show-current']).stdout.trim() !== 'main') {
    throw new Error('Run npm run release from the main branch.');
  }
  if (runGit(['status', '--porcelain']).stdout.trim()) {
    throw new Error('Commit or stash all changes before creating a release.');
  }

  const head = runGit(['rev-parse', 'HEAD']).stdout.trim();
  const remoteHead = runGit(['ls-remote', 'origin', 'refs/heads/main']).stdout.trim().split(/\s+/)[0];
  if (!remoteHead || remoteHead !== head) {
    throw new Error('Push the current main branch to origin before creating a release.');
  }

  const remoteTag = runGit(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remoteTag.stdout.trim()) {
    throw new Error(`Release tag ${tag} already exists. Update and commit the package version before releasing again.`);
  }

  const localTagRef = runGit(['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { allowFailure: true });
  if (localTagRef.status !== 0 && localTagRef.status !== 1) {
    throw new Error(localTagRef.stderr.trim() || `Could not check local tag ${tag}.`);
  }
  if (localTagRef.status === 0) {
    const localTagCommit = runGit(['rev-parse', '--verify', `${tag}^{commit}`]).stdout.trim();
    if (localTagCommit !== head) {
      runGit(['tag', '--force', '--annotate', tag, '--message', `Release ${version}`, head]);
      console.log(`Recreated stale local tag ${tag} at ${head}; the matching remote tag is absent.`);
    }
  } else {
    runGit(['tag', '-a', tag, '-m', `Release ${tag}`]);
  }
  runGit(['push', 'origin', tag]);
  console.log(`Pushed ${tag}. GitHub Actions will build and publish the Windows release.`);
}

try {
  main();
} catch (error) {
  console.error(`Release failed: ${error.message}`);
  process.exitCode = 1;
}
