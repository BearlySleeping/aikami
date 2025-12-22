import { toAppError } from '@aikami/utils'

export const blobToBase64 = (blob: Blob): Promise<string> => {
  const reader = new FileReader()
  reader.readAsDataURL(blob)
  return new Promise<string>((resolve) => {
    reader.onloadend = () => {
      const base64String = reader.result as string
      const base64 = base64String.split(',')[1]
      if (!base64) {
        throw toAppError('internal', 'base64 is not defined')
      }
      resolve(base64)
    }
  })
}

/**
 * Removes the .<extension> from the file name.
 *
 * @example file-name.mp4 -> file-name
 *
 * @param file The file
 * @returns the file name
 */
export const getFileNameWithoutExtension = (file: File): string => {
  const fileName = file.name
  const fileExtension = getFileExtensionFromFileName(fileName)
  return fileExtension ? fileName.slice(0, -(fileExtension.length + 1)) : fileName
}

// https://stackoverflow.com/questions/190852/how-can-i-get-file-extensions-with-javascript/12900504#12900504
export const getFileExtensionFromFileName = (fileName: string): string =>
  fileName.slice(((fileName.lastIndexOf('.') - 1) >>> 0) + 2)

export const isInIframe = (): boolean => {
  try {
    return globalThis.self !== globalThis.top
  } catch (_e) {
    return true
  }
}
