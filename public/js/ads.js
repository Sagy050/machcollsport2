(function () {
  'use strict';
  var list = document.getElementById('ad-list');
  var search = document.getElementById('ad-search');
  var clubFilter = document.getElementById('ad-club');
  var ads = [];
  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  };
  var phoneDigits = function (value) { return String(value || '').replace(/\D/g, ''); };

  function render() {
    var query = search.value.trim().toLowerCase();
    var club = clubFilter.value;
    var filtered = ads.filter(function (ad) {
      var text = [ad.club_name, ad.title, ad.description, ad.location, ad.representative_name].join(' ').toLowerCase();
      return (!club || ad.club_name === club) && (!query || text.indexOf(query) !== -1);
    });
    if (!filtered.length) {
      list.innerHTML = '<div class="marketplace-state"><b>' + (ads.length ? 'No matching ads' : 'No ads just yet') + '</b><span>' +
        (ads.length ? 'Try another search or choose a different club.' : 'Check back soon for student club sales and offers.') + '</span></div>';
      return;
    }
    list.innerHTML = filtered.map(function (ad) {
      var photo = ad.image_url
        ? '<img class="marketplace-photo" src="' + esc(ad.image_url) + '" alt="' + esc(ad.representative_name) + ' from ' + esc(ad.club_name) + '" loading="lazy">'
        : '<div class="marketplace-photo marketplace-photo-empty" aria-label="No representative photo">Machabeng club</div>';
      var whatsapp = phoneDigits(ad.whatsapp || ad.phone);
      return '<article class="marketplace-card"><div class="marketplace-photo-wrap">' + photo + '</div><div class="marketplace-card-copy">' +
        '<span class="marketplace-club">' + esc(ad.club_name) + '</span><h2>' + esc(ad.title) + '</h2>' +
        (ad.description ? '<p class="marketplace-description">' + esc(ad.description) + '</p>' : '') +
        (ad.price ? '<p class="marketplace-price">' + esc(ad.price) + '</p>' : '') +
        (ad.location ? '<p class="marketplace-detail"><b>Find us</b><span>' + esc(ad.location) + '</span></p>' : '') +
        '<p class="marketplace-detail"><b>Representative</b><span>' + esc(ad.representative_name) + '</span></p>' +
        (ad.selling_when ? '<p class="marketplace-detail"><b>When</b><span>' + esc(ad.selling_when) + '</span></p>' : '') +
        '<div class="marketplace-actions"><a class="btn" href="tel:' + esc(ad.phone.replace(/[^\d+]/g, '')) + '">Call ' + esc(ad.phone) + '</a>' +
        (whatsapp ? '<a class="btn ghost" href="https://wa.me/' + encodeURIComponent(whatsapp) + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>' : '') +
        '</div></div></article>';
    }).join('');
  }

  search.addEventListener('input', render);
  clubFilter.addEventListener('change', render);
  fetch('/api/ads', { cache: 'no-store' }).then(function (response) {
    if (!response.ok) throw new Error('Ads could not be loaded. Please try again later.');
    return response.json();
  }).then(function (result) {
    ads = Array.isArray(result.ads) ? result.ads : [];
    var clubs = Array.from(new Set(ads.map(function (ad) { return ad.club_name; }))).sort();
    clubs.forEach(function (club) {
      var option = document.createElement('option');
      option.value = club;
      option.textContent = club;
      clubFilter.appendChild(option);
    });
    render();
  }).catch(function (error) {
    list.innerHTML = '<div class="marketplace-state" role="alert">' + esc(error.message || 'Ads could not be loaded. Please try again later.') + '</div>';
  });
})();
