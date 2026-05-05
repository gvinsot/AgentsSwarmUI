const params = new URLSearchParams(window.location.search);
const code = params.get('code');
const state = params.get('state');
const error = params.get('error');
const errorDesc = params.get('error_description');

if (error) {
  document.getElementById('spinner').style.display = 'none';
  document.getElementById('message').className = 'error';
  document.getElementById('message').textContent = 'Error: ' + (errorDesc || error);
} else if (code) {
  if (window.opener) {
    window.opener.postMessage({ type: 'gmail-oauth-callback', code: code, state: state }, '*');
    document.getElementById('spinner').style.display = 'none';
    document.getElementById('message').className = 'success';
    document.getElementById('message').textContent = 'Connected! This window will close...';
    setTimeout(function() { window.close(); }, 1500);
  } else {
    document.getElementById('spinner').style.display = 'none';
    document.getElementById('message').textContent = 'Authorization successful. You can close this window.';
  }
} else {
  document.getElementById('spinner').style.display = 'none';
  document.getElementById('message').className = 'error';
  document.getElementById('message').textContent = 'No authorization code received.';
}
