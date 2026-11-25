/**
 * File: tools.js
 * Path: pos-app/js/tools.js
 * Description: Storefront Tools module.
 *              Uploads carousel images (up to 5) to the server. The customer
 *              app shows whatever the server returns.
 */

const storefrontTools = {
  carouselImages: [],
};

/** Matches the 16:9 frame the customer app shows for carousel slides. */
const CAROUSEL_ASPECT_RATIO = 16 / 9;

async function loadCarousel() {
  const container = $('#tools-carousel-preview');
  if (container && storefrontTools.carouselImages.length === 0) {
    container.innerHTML = Array.from({ length: 3 }, () => `
      <div class="skeleton-carousel-tile pos-skeleton-bone" aria-hidden="true"></div>
    `).join('');
  }
  const q = POS.user?.branchId ? `?branchId=${encodeURIComponent(POS.user.branchId)}` : '';
  const res = await fetch(`/api/public/carousel${q}`, { credentials: 'same-origin' });
  storefrontTools.carouselImages = res.ok ? await res.json() : [];
  renderCarouselPreviews();
}

function renderCarouselPreviews() {
  const container = $('#tools-carousel-preview');
  if (!container) return;

  container.innerHTML = storefrontTools.carouselImages.map((img, i) => `
    <div class="relative group rounded-lg overflow-hidden border border-slate-200 shadow-sm">
      <img src="${img.publicUrl}" alt="Carousel ${i + 1}" class="w-full aspect-video object-cover pos-img-loading">
      <button data-carousel-remove="${img.id}" aria-label="Remove carousel image ${i + 1}" class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-700 text-white text-xs font-bold flex items-center justify-center opacity-90 group-hover:opacity-100 transition-opacity shadow">&times;</button>
    </div>
  `).join('');
}

function bindCarouselUpload() {
  const input = $('#tools-carousel-url');
  if (!input) return;

  input.addEventListener('change', async () => {
    const files = Array.from(input.files);
    input.value = '';
    for (const file of files) {
      const cropped = await cropImage(file, { aspectRatio: CAROUSEL_ASPECT_RATIO });
      if (!cropped) continue;
      const res = await uploadBranchImage('/api/uploads/carousel', cropped, file.name);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(data?.error || `Upload failed (HTTP ${res.status})`, 'error');
        if (res.status === 409) break;
      }
    }
    await loadCarousel();
  });

  $('#tools-carousel-preview')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-carousel-remove]');
    if (!button) return;
    const res = await fetch(`/api/carousel/${button.dataset.carouselRemove}`, { method: 'DELETE', credentials: 'same-origin' });
    if (!res.ok) showToast('Could not remove the image', 'error');
    await loadCarousel();
  });
}

function initTools() {
  bindCarouselUpload();
  loadCarousel();
}
