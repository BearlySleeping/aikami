/// <reference types="astro/client" />

interface ImportMetaEnv {
	/** "v.X.X.X"
	 *
	 */
	readonly RELEASE_TAG: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
