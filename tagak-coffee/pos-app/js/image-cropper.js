/** Turns a cropped data URL into a Blob that keeps its image type for the upload. */
function croppedBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const type = header.slice(5, header.indexOf(';'));
  const bytes = atob(data);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type });
}

/**
 * Opens a freeform crop dialog and returns a resized image data URL, or null
 * when canceled or the selected file cannot be decoded.
 * @param {File} file
 * @param {{ aspectRatio?: number }} [options] Fixed width/height ratio; omit for freeform.
 * @returns {Promise<string|null>}
 */
function cropImage(file, options = {}) {
  const aspectRatio = options.aspectRatio ?? NaN;
  return new Promise(resolve => {
    const dialog = $('#image-crop-modal');
    const image = $('#image-crop-source');
    const cancel = $('#image-crop-cancel');
    const confirm = $('#image-crop-confirm');
    let cropper = null;
    let objectUrl = null;
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      cropper?.destroy();
      cropper = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      image.onload = null;
      image.onerror = null;
      cancel.removeEventListener('click', onCancel);
      confirm.removeEventListener('click', onConfirm);
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      resolve(result);
    };

    const onCancel = () => finish(null);
    const onConfirm = () => {
      if (!cropper) return;
      try {
        const canvas = cropper.getCroppedCanvas({ maxWidth: 1200, maxHeight: 1200 });
        if (!canvas) throw new Error('Unable to crop image');
        const mimeType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type : 'image/png';
        const dataUrl = canvas.toDataURL(mimeType, 0.9);
        if (!dataUrl.startsWith('data:image/')) throw new Error('Unable to crop image');
        finish(dataUrl);
      } catch (_) {
        showToast('Unable to crop this image', 'error');
        finish(null);
      }
    };

    image.onload = () => {
      try {
        cropper = new Cropper(image, { aspectRatio, viewMode: 1, responsive: true, autoCropArea: 1 });
        cancel.addEventListener('click', onCancel);
        confirm.addEventListener('click', onConfirm);
        dialog.addEventListener('cancel', onCancel);
        dialog.showModal();
        cancel.focus();
      } catch (_) {
        showToast('Unable to open the image cropper', 'error');
        finish(null);
      }
    };
    image.onerror = () => {
      showToast('Please choose a valid image file', 'error');
      finish(null);
    };

    try {
      objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
    } catch (_) {
      showToast('Unable to read this image file', 'error');
      finish(null);
    }
  });
}

async function uploadBranchImage(endpoint, image, filename) {
  const file = image instanceof Blob ? image : croppedBlob(image);
  const post = body => fetch(endpoint, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const start = await post({ stage: 'sign', mimeType: file.type, size: file.size });
  if (!start.ok) return start;
  const grant = await start.json();
  if (grant.multipart) {
    const body = new FormData();
    body.append('file', file, filename);
    return fetch(endpoint, { method: 'POST', credentials: 'same-origin', body });
  }
  const uploaded = await fetch(grant.signedUrl, { method: 'PUT', credentials: 'omit',
    headers: { 'Content-Type': file.type }, body: file });
  if (!uploaded.ok) return uploaded;
  return post({ stage: 'finish', id: grant.id });
}
