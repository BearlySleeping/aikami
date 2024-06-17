const huggingFaceAccessToken = process.env['API_HUGGING_FACE_KEY'];

if (!huggingFaceAccessToken) {
	throw new Error('API_HUGGING_FACE_KEY environment variable is not set');
}

export { huggingFaceAccessToken };
