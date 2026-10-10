import { ref, uploadBytesResumable } from './firebase.bundle.js';

export async function uploadPhoto(staffApi, storage, collection, file, onProgress = () => {}) {
  if (!storage) throw new Error('Firebase Storage is being configured.');
  if (
    !file ||
    !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
    file.size < 1 ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('Choose a JPG, PNG, WebP or GIF smaller than 10 MB.');
  const ticket = await staffApi('/api/uploads/ticket', {
    method: 'POST',
    body: { collection, contentType: file.type, size: file.size },
  });
  const task = uploadBytesResumable(ref(storage, ticket.storagePath), file, {
    contentType: file.type,
  });
  await new Promise((resolve, reject) =>
    task.on(
      'state_changed',
      (s) => onProgress(Math.round((100 * s.bytesTransferred) / s.totalBytes)),
      reject,
      resolve,
    ),
  );
  return ticket.ticketId;
}
