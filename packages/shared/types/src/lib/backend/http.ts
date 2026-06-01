// biome-ignore lint/style/useNamingConvention: established acronym CRUDL
export type CRUDL = 'create' | 'read' | 'update' | 'delete' | 'list';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete';

export type CRUDRequest = {
  url: string;
  method: 'get' | 'post' | 'put' | 'delete';
};
