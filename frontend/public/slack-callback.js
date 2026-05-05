var params = new URLSearchParams(window.location.search);
var code = params.get('code');
var state = params.get('state');
var error = params.get('error');

if (error) {
  document.getElementById('spinner').style.display = 'none';
  document.getElementById('message').className = 'error';
  document.getElementById('message').textContent = 'Error: ' + error;
} else if (code) {
  if (window.opener) {
    window.opener.postMessage({ type: 'slack-oauth-callback', code: code, state: state }, '*');
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
