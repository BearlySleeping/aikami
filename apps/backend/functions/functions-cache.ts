import axios from 'axios';
import type {
  FunctionsCache,
  FunctionsCacheFetch,
  FunctionsCacheUpdate,
} from 'nx-cloud-functions-deployer';

const baseURL = 'https://api.jsonbin.io/v3/b';

const getBinId = (flavor: string): string => {
  switch (flavor) {
    case 'development':
      return '6331878ea1610e63863950af';
    case 'production':
      return '635841e60e6a79321e345e8c';
    case 'staging':
      return '64312542ebd26539d0a6c9ee';
    default:
      throw new Error(`Unknown flavor: ${flavor}`);
  }
};

const masterKey = '$2b$10$aKk5wBPTio4d6rkJ9g397OBD3DYZRTTzh/MyQ5f8JTDeGuiCR6MyO';

export const fetch: FunctionsCacheFetch = async ({ flavor }) => {
  const binId = getBinId(flavor);
  const response = await axios.get<FunctionsCache>(`${baseURL}/${binId}/latest`, {
    headers: {
      'X-Bin-Meta': 'false',
      'X-Master-Key': masterKey,
    },
  });
  return response.data;
};

export const update: FunctionsCacheUpdate = async ({ flavor, newFunctionsCache }) => {
  const binId = getBinId(flavor);

  const oldFunctionsCache = await fetch({ flavor });

  const mergedFunctionsCache = {
    ...oldFunctionsCache,
    ...newFunctionsCache,
  };

  await axios.put(`${baseURL}/${binId}`, mergedFunctionsCache, {
    headers: {
      'X-Master-Key': masterKey,
    },
  });
};
