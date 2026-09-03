<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/backup/+page.svelte
import BackupView from '$views/dev/backup/backup_view.svelte';
import { getBackupViewModel } from '$views/dev/backup/backup_view_model.svelte';

const viewModel = getBackupViewModel({
  className: 'BackupViewModel',
});
</script>

<BackupView {viewModel} />
