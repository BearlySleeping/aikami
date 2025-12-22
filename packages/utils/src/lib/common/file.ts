/**
 * Splits a file into parts for multipart upload.
 *
 * @param options The file to split, the part size and the total amount of
 *   parts.
 * @returns The file parts.
 */
export const splitFile = (options: {
  file: Blob
  totalPartsAmount: number
  partSize: number
}): Blob[] => {
  const { file, partSize, totalPartsAmount } = options
  const blobs: Blob[] = []
  let start: number
  let end: number
  for (let index = 1; index < totalPartsAmount + 1; index++) {
    start = (index - 1) * partSize
    end = index * partSize

    blobs.push(
      index < totalPartsAmount ? file.slice(start, end) : file.slice(start),
    )
  }

  return blobs
}
