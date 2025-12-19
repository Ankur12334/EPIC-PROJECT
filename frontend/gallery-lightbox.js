// static/assets/gallery-lightbox.js
// Optional helper if you want to open the lightbox programmatically.

window.openGalleryLightbox = function (images, startIndex = 0) {
  if (!images || !images.length) return;

  let index = startIndex;
  const overlay = document.createElement('div');
  overlay.className = 'gallery-lightbox';

  const img = document.createElement('img');
  img.src = images[index];
  overlay.appendChild(img);

  // close on outside click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // keyboard controls
  function onKey(e) {
    if (e.key === 'Escape') overlay.remove();
    if (e.key === 'ArrowLeft') {
      index = (index - 1 + images.length) % images.length;
      img.src = images[index];
    }
    if (e.key === 'ArrowRight') {
      index = (index + 1) % images.length;
      img.src = images[index];
    }
  }

  window.addEventListener('keydown', onKey);
  
  document.body.appendChild(overlay);
};
