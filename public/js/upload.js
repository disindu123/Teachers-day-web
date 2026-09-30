// The server signs a fixed image ID after verifying the Firebase administrator.
// Files go directly to Cloudinary; the API secret never reaches this module.
export async function uploadPhoto(adminApi, collection, file, onProgress = () => {}) {
  if (
    !file ||
    !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('Choose a JPG, PNG, WebP, or GIF smaller than 10 MB.');
  const ticket = await adminApi('/api/uploads/sign', {
    method: 'POST',
    body: { collection },
  });
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', ticket.apiKey);
  for (const [key, value] of Object.entries(ticket.params)) form.append(key, String(value));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ticket.uploadUrl);
    xhr.responseType = 'json';
    xhr.timeout = 180000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () =>
      reject(new Error('The upload failed. Check your connection and try again.'));
    xhr.ontimeout = () =>
      reject(new Error('The upload timed out. Try again with a smaller photo.'));
    xhr.onabort = () => reject(new Error('The upload was cancelled.'));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300)
        return reject(
          new Error(xhr.response?.error?.message || 'Cloudinary could not upload this photo.'),
        );
      if (xhr.response?.public_id !== ticket.params.public_id)
        return reject(new Error('The upload could not be verified. Try again.'));
      onProgress(100);
      resolve(xhr.response.public_id);
    };
    xhr.send(form);
  });
}
