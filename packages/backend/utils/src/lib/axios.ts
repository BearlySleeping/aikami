import axios, {
  type AxiosRequestConfig,
  type AxiosResponse,
  type RawAxiosRequestHeaders,
} from 'axios'
import { URL, URLSearchParams } from 'node:url'
import logger from '$logger'

export type QueryParameters = Record<
  string,
  boolean | number | string | undefined
>

export const addQueryParameters = (urlPath: string, data: QueryParameters) => {
  const url = new URL(urlPath)

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      url.searchParams.append(key, value.toString())
    }
  }
  return url.href
}

export const toURLSearchParameters = (data: QueryParameters) => {
  const parameters = new URLSearchParams()
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      parameters.append(key, value.toString())
    }
  }
  return parameters
}

export type RequestConfig = {
  accept?: string
  bearerToken?: string
  contentType?: string
  origin?: string
  timeout?: number
}

const getRequestConfig = (requestConfig: RequestConfig): AxiosRequestConfig => {
  const headers: RawAxiosRequestHeaders = {}
  if (requestConfig.accept) {
    headers.Accept = requestConfig.accept
  }
  if (requestConfig.contentType) {
    headers['Content-Type'] = requestConfig.contentType
  }
  if (requestConfig.bearerToken) {
    headers.Authorization = `Bearer ${requestConfig.bearerToken}`
  }
  if (requestConfig.origin) {
    headers['Origin'] = requestConfig.origin
  }

  return {
    headers,
    timeout: requestConfig.timeout ?? 30000,
  }
}

export const axiosPost = async <T = unknown, Y = unknown>({
  data = {} as Y,
  queryParams,
  url,
  ...requestConfig
}: RequestConfig & {
  data?: Y
  queryParams?: QueryParameters
  url: string
}): Promise<T> => {
  if (queryParams) {
    url = addQueryParameters(url, queryParams)
  }

  try {
    const response: AxiosResponse<T> = await axios.post(
      url,
      data &&
        requestConfig.contentType ===
          'application/x-www-form-urlencoded'
        ? toURLSearchParameters(data as unknown as QueryParameters)
        : data,
      getRequestConfig(requestConfig),
    )

    return response.data
  } catch (error) {
    logger.error('axiosPost', { data, error, url })
    throw error
  }
}

export const axiosPut = async <T = unknown, Y = unknown>({
  data = {} as Y,
  queryParams,
  url,
  ...requestConfig
}: RequestConfig & {
  data?: Y
  queryParams?: QueryParameters
  url: string
}): Promise<T> => {
  if (queryParams) {
    url = addQueryParameters(url, queryParams)
  }

  try {
    const response: AxiosResponse<T> = await axios.put(
      url,
      data &&
        requestConfig.contentType ===
          'application/x-www-form-urlencoded'
        ? toURLSearchParameters(data as unknown as QueryParameters)
        : data,
      getRequestConfig(requestConfig),
    )

    return response.data
  } catch (error) {
    logger.error('axiosPut', { data, error, url })
    throw error
  }
}

export const axiosGet = async <T = unknown>({
  queryParams,
  url,
  ...requestConfig
}: RequestConfig & {
  queryParams?: QueryParameters
  url: string
}): Promise<T> => {
  logger.debug('axiosGet', url, queryParams, requestConfig)

  try {
    const response: AxiosResponse<T> = await axios.get(
      queryParams ? addQueryParameters(url, queryParams) : url,
      getRequestConfig(requestConfig),
    )

    return response.data
  } catch (error) {
    logger.error('axiosGet', { error, url })
    throw error
  }
}

export const axiosDelete = async <T = unknown>({
  queryParams,
  url,
  ...requestConfig
}: RequestConfig & {
  queryParams?: QueryParameters
  url: string
}): Promise<T> => {
  try {
    const response: AxiosResponse<T> = await axios.delete(
      queryParams ? addQueryParameters(url, queryParams) : url,
      getRequestConfig(requestConfig),
    )

    return response.data
  } catch (error) {
    logger.error('axiosDelete', { error, url })
    throw error
  }
}
