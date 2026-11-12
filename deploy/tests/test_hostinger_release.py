"""Run deployment scripts against fake CLIs; never connect to the VPS or Docker."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[2]
BASH = shutil.which('bash') or (
    r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None
)
TARGET = 'a' * 40
PREVIOUS = 'b' * 40


def shell_path(path):
    path = Path(path)
    if os.name == 'nt':
        return '/' + path.drive[0].lower() + '/' + path.relative_to(path.anchor).as_posix()
    return str(path)


@unittest.skipUnless(BASH and Path(BASH).is_file(), 'Bash is required')
class HostingerReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='eworkspace-release-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.app = self.root / 'app'
        (self.app / 'data').mkdir(parents=True)
        (self.app / 'private').mkdir()
        (self.app / '.deploy').mkdir()
        self.protected_files = {
            '.env': 'ADMIN_PASSWORD=test-only-value\n',
            'data/emails.json': '["mailbox@example.com"]\n',
            'private/workspace_service_account.json': '{"test":true}\n',
        }
        for filename, value in self.protected_files.items():
            (self.app / filename).write_text(value, encoding='utf-8')
        (self.app / 'compose.yaml').write_text('name: eworkspace\n# new compose\n', encoding='utf-8')
        self.old_compose = 'name: eworkspace\n# previous compose\n'
        (self.app / '.deploy/current-compose.yaml').write_text(self.old_compose, encoding='utf-8')
        self.log = self.root / 'docker.log'
        self.env = dict(os.environ)
        path_entries = [str(self.bin)]
        if os.name == 'nt':
            path_entries.append(str(Path(BASH).parents[1] / 'usr/bin'))
        path_entries.append(self.env.get('PATH', ''))
        self.env.update(PATH=os.pathsep.join(path_entries), COMMAND_LOG=shell_path(self.log), TARGET_SHA=TARGET, TEST_APP=shell_path(self.app))
        self.executable('python3', f'#!/usr/bin/env bash\nexec "{Path(sys.executable).as_posix()}" "$@"\n')
        self.executable('git', r'''#!/usr/bin/env bash
case "$*" in
  "rev-parse --show-toplevel") printf '%s\n' "$TEST_APP" ;;
  "remote get-url origin") printf '%s\n' 'https://github.com/info-321/React-Email-Dashboard.git' ;;
  "rev-parse HEAD"|"rev-parse refs/remotes/origin/main") printf '%s\n' "$TARGET_SHA" ;;
  "status --porcelain --untracked-files=no") printf '%s' "${TRACKED_CHANGES:-}" ;;
esac
''')
        self.executable('install', '#!/usr/bin/env bash\nmkdir -p "${@: -1}"\n')
        self.executable('flock', '#!/usr/bin/env bash\nexit 0\n')
        self.executable('docker', r'''#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$COMMAND_LOG"
case "$*" in
  *"config --format json"*)
    printf '%s\n' '{"name":"eworkspace","services":{"web":{"image":"ttw-eworkspace:local","ports":[{"host_ip":"127.0.0.1","published":"8161"}]}}}' ;;
  *"ps -q web"*) printf 'old-container\n' ;;
  inspect*) printf 'sha256:old-image\n' ;;
  *"build web"*) [[ "${SCENARIO:-}" != build-failure ]] || exit 12 ;;
  *" up "*)
    if [[ "${SCENARIO:-}" == activation-failure && "$*" != *" -f "* ]]; then exit 42; fi ;;
esac
''')
        self.executable('curl', r'''#!/usr/bin/env bash
set -eu
case "$*" in
  *api/emails*)
    if [[ "${SCENARIO:-}" == protection-failure ]]; then printf 200; else printf 401; fi ;;
  *) printf '{"status":"ok"}\n' ;;
esac
''')
        source = (REPO / 'deploy/hostinger-release.sh').read_text(encoding='utf-8')
        self.script = self.root / 'release.sh'
        source = source.replace('/opt/eworkspace', shell_path(self.app))
        source = source.replace('set -Eeuo pipefail', f'set -Eeuo pipefail\nexport PATH="{shell_path(self.bin)}:/usr/bin:$PATH"', 1)
        self.script.write_text(source, encoding='utf-8', newline='\n')
        entrypoint = (REPO / 'deploy/hostinger-entrypoint.sh').read_text(encoding='utf-8')
        entrypoint = entrypoint.replace('/opt/eworkspace', shell_path(self.app))
        entrypoint = entrypoint.replace('set -Eeuo pipefail', f'set -Eeuo pipefail\nexport PATH="{shell_path(self.bin)}:/usr/bin:$PATH"', 1)
        self.entrypoint = self.root / 'entrypoint.sh'
        self.entrypoint.write_text(entrypoint, encoding='utf-8', newline='\n')
        (self.app / 'deploy').mkdir()
        (self.app / 'deploy/hostinger-release.sh').write_text('printf "%s\\n" "$@" > .deploy/release-arguments\n', encoding='utf-8')

    def executable(self, name, content):
        path = self.bin / name
        path.write_text(content, encoding='utf-8', newline='\n')
        path.chmod(0o755)

    def run_release(self, scenario='success'):
        self.env['SCENARIO'] = scenario
        result = subprocess.run([BASH, str(self.script), TARGET, PREVIOUS],
            env=self.env, text=True, capture_output=True, timeout=30)
        for filename, original in self.protected_files.items():
            self.assertEqual((self.app / filename).read_text(encoding='utf-8'), original)
        commands = self.log.read_text(encoding='utf-8') if self.log.exists() else ''
        self.assertNotIn('emailhub', commands)
        self.assertNotIn(' down', commands)
        self.assertNotIn('prune', commands)
        self.assertEqual(list((self.app / '.deploy').glob('previous-compose.*.yaml')), [])
        return result, commands

    def test_success_records_commit_and_preserves_production_files(self):
        result, commands = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.app / '.deploy/deployed-sha').read_text().strip(), TARGET)
        self.assertEqual((self.app / '.deploy/current-compose.yaml').read_text(), (self.app / 'compose.yaml').read_text())
        self.assertIn('build web', commands)
        self.assertIn('--wait --wait-timeout 120 web', commands)

    def test_build_failure_leaves_running_container_in_place(self):
        result, commands = self.run_release('build-failure')
        self.assertEqual(result.returncode, 12, result.stderr)
        self.assertNotIn(' up ', commands)
        self.assertFalse((self.app / '.deploy/deployed-sha').exists())

    def test_activation_failure_restores_previous_image_and_reports_failure(self):
        result, commands = self.run_release('activation-failure')
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertIn('image tag sha256:old-image ttw-eworkspace:local', commands)
        self.assertIn(' -f ', commands)
        self.assertEqual((self.app / '.deploy/current-compose.yaml').read_text(), self.old_compose)
        self.assertFalse((self.app / '.deploy/deployed-sha').exists())

    def test_unprotected_api_triggers_rollback(self):
        result, commands = self.run_release('protection-failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('image tag sha256:old-image ttw-eworkspace:local', commands)
        self.assertFalse((self.app / '.deploy/deployed-sha').exists())

    def test_ssh_entrypoint_rejects_arbitrary_commands(self):
        self.env['SSH_ORIGINAL_COMMAND'] = 'cat /opt/eworkspace/.env'
        result = subprocess.run([BASH, str(REPO / 'deploy/hostinger-entrypoint.sh')],
            env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.log.exists())

    def test_ssh_entrypoint_deploys_the_current_main_commit(self):
        self.env['SSH_ORIGINAL_COMMAND'] = 'deploy ' + TARGET
        result = subprocess.run([BASH, str(self.entrypoint)], env=self.env,
            text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.app / '.deploy/release-arguments').read_text().splitlines(), [TARGET, TARGET])

    def test_ssh_entrypoint_skips_a_superseded_commit(self):
        self.env['SSH_ORIGINAL_COMMAND'] = 'deploy ' + PREVIOUS
        result = subprocess.run([BASH, str(self.entrypoint)], env=self.env,
            text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.app / '.deploy/release-arguments').exists())

    def test_ssh_entrypoint_preserves_tracked_server_edits(self):
        self.env.update(SSH_ORIGINAL_COMMAND='deploy ' + TARGET, TRACKED_CHANGES=' M server/app.py')
        result = subprocess.run([BASH, str(self.entrypoint)], env=self.env,
            text=True, capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.app / '.deploy/release-arguments').exists())


if __name__ == '__main__':
    unittest.main()
