<script lang="ts">
import { getBackupViewModel } from '$views/dev/backup/backup_composition';
// apps/frontend/client/src/routes/(dev)/dev/backup/+page.svelte
import BackupView from '$views/dev/backup/backup_view.svelte';

const viewModel = getBackupViewModel({
  className: 'BackupViewModel',
});
</script>

<BackupView {viewModel} />
