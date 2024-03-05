const huggingFaceAccessToken = process.env['HUGGING_FACE_ACCESS_TOKEN'];

if (!huggingFaceAccessToken) {
	throw new Error(
		'HUGGING_FACE_ACCESS_TOKEN environment variable is not set',
	);
}

export { huggingFaceAccessToken };
