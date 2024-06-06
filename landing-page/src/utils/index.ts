export const getReleaseTagVersion = (): string => {
	if (!import.meta.env.DEV) {
		return 'v0.0.0';
	}

	const version = import.meta.env.RELEASE_TAG;
	if (!version) {
		throw new Error('RELEASE_TAG is required');
	}
	if (!version.startsWith('v')) {
		throw new Error('RELEASE_TAG must be "v.X.X.X" format');
	}
	return version;
};
