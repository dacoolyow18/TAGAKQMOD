const { publicBaseUrl } = require('./publicUrl');
const { readCookie } = require('./auth/sessions');

const validTicket = /^TK-\d{8}-\d{4,}$/;
const validToken = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

function setTrackingCookie(res, ticket, token) {
  res.cookie('tagak_track_' + ticket, token, {
    path: '/api/public/orders', httpOnly: true, sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production' || publicBaseUrl().startsWith('https://'),
  });
}

function trackingKeys(req, tickets) {
  return tickets.map(ticket => readCookie(req, 'tagak_track_' + ticket)).filter(key => validToken.test(key));
}

module.exports = { validTicket, validToken, setTrackingCookie, trackingKeys };
