// Login gate for the invite-only CMA Studio web app.
// No sign-up here — accounts are created by invitation only, so this is sign-in only.
import { el } from './ui.js';
import { supabase } from './supa.js';

// renderLogin(mount, onSuccess)
//   mount     — the app root element; we clear it and drop the login screen in.
//   onSuccess — called (no args) once the user is signed in.
export function renderLogin(mount, onSuccess) {
  mount.innerHTML = '';

  // The two message lines: .login-error for problems, .login-note for friendly confirmations.
  const errorLine = el('div', { class: 'login-error' });
  const noteLine  = el('div', { class: 'login-note' });

  // Inputs — the app's global input CSS styles these; we just label them well.
  const emailInput = el('input', {
    type: 'email',
    autocomplete: 'username',
    placeholder: 'you@century21.ca',
  });
  const passInput = el('input', {
    type: 'password',
    autocomplete: 'current-password',
  });

  const submitBtn = el('button', { class: 'btn btn-primary login-btn', type: 'submit' }, 'Sign in');

  // Small helpers to keep the two message lines from talking over each other.
  const showError = (msg) => { errorLine.textContent = msg; noteLine.textContent = ''; };
  const showNote  = (msg) => { noteLine.textContent  = msg; errorLine.textContent = ''; };
  const clearMsgs = () => { errorLine.textContent = ''; noteLine.textContent = ''; };

  // ---- Sign in ------------------------------------------------------------
  async function handleSubmit(e) {
    e.preventDefault();
    clearMsgs();

    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) {
      showError('Enter your email and password.');
      return;
    }

    // Lock the button so a slow network can't trigger a double sign-in.
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showError(error.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
      return;
    }

    onSuccess();
  }

  // ---- Forgot password ----------------------------------------------------
  // Reads whatever's in the email field and mails a reset link there.
  async function handleForgot(e) {
    e.preventDefault();
    clearMsgs();

    const email = emailInput.value.trim();
    if (!email) {
      showError('Enter your email above first, then tap “Forgot password?”.');
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) showError(error.message);
    else showNote('Check your email for a reset link.');
  }

  const form = el('form', { class: 'login-form', onsubmit: handleSubmit },
    el('div', { class: 'login-field' },
      el('label', {}, 'Email'),
      emailInput,
    ),
    el('div', { class: 'login-field' },
      el('label', {}, 'Password'),
      passInput,
    ),
    submitBtn,
    errorLine,
    noteLine,
    el('a', { class: 'login-forgot', href: '#', onclick: handleForgot }, 'Forgot password?'),
  );

  const card = el('div', { class: 'login-card' },
    el('div', { class: 'login-logo' }, 'CMA'),
    el('div', { class: 'login-title' }, 'CMA Studio'),
    el('div', { class: 'login-sub' }, 'Sign in to your account'),
    form,
  );

  mount.append(el('div', { class: 'login-screen' }, card));

  // Nudge the cursor into the email field so the user can just start typing.
  emailInput.focus();
}

// renderSetPassword(mount, onDone, opts)
//   The "choose a new password" card, reused in two situations:
//     (1) a recovery email link was clicked (app.js sees PASSWORD_RECOVERY), and
//     (2) a temp-password account on first login (must_reset) is forced to pick
//         its own password before using the app.
//   opts.heading / opts.intro tailor the copy for each case. On a successful
//   save it calls onDone() — the caller decides what happens next (re-init, and
//   for the must_reset case, clearing the flag first).
export function renderSetPassword(mount, onDone, opts = {}) {
  mount.innerHTML = '';

  const heading = opts.heading || 'Set a new password';
  const intro   = opts.intro   || 'Choose a password for your account.';

  const errorLine = el('div', { class: 'login-error' });
  const noteLine  = el('div', { class: 'login-note' });

  const passInput = el('input', {
    type: 'password',
    autocomplete: 'new-password',
    placeholder: 'At least 8 characters',
  });
  const confirmInput = el('input', {
    type: 'password',
    autocomplete: 'new-password',
  });

  const submitBtn = el('button', { class: 'btn btn-primary login-btn', type: 'submit' }, 'Save password');

  const showError = (msg) => { errorLine.textContent = msg; noteLine.textContent = ''; };
  const showNote  = (msg) => { noteLine.textContent  = msg; errorLine.textContent = ''; };

  async function handleSubmit(e) {
    e.preventDefault();
    showError('');

    const pw = passInput.value;
    const confirm = confirmInput.value;
    if (pw.length < 8) { showError('Use at least 8 characters.'); return; }
    if (pw !== confirm) { showError('Those two passwords don’t match.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      showError(error.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save password';
      return;
    }

    showNote('Password saved. Signing you in…');
    // Brief beat so the confirmation is readable, then hand back to the caller.
    setTimeout(() => onDone(), 700);
  }

  const form = el('form', { class: 'login-form', onsubmit: handleSubmit },
    el('div', { class: 'login-field' },
      el('label', {}, 'New password'),
      passInput,
    ),
    el('div', { class: 'login-field' },
      el('label', {}, 'Confirm password'),
      confirmInput,
    ),
    submitBtn,
    errorLine,
    noteLine,
  );

  const card = el('div', { class: 'login-card' },
    el('div', { class: 'login-logo' }, 'CMA'),
    el('div', { class: 'login-title' }, heading),
    el('div', { class: 'login-sub' }, intro),
    form,
  );

  mount.append(el('div', { class: 'login-screen' }, card));
  passInput.focus();
}

// signOut() — end the session and hard-reload so the app re-gates at the login screen.
export async function signOut() {
  await supabase.auth.signOut();
  window.location.reload();
}
