#!/usr/bin/env python3
"""
Extract Suno __session JWT from Chrome cookies.
Requires Chrome to be CLOSED (DB locked otherwise).
Usage: python3 extract-session.py
"""

import sqlite3, os, subprocess, json, sys
from pathlib import Path

CHROME_COOKIES = Path.home() / 'Library/Application Support/Google/Chrome/Default/Cookies'
CHROME_LOCAL_STATE = Path.home() / 'Library/Application Support/Google/Chrome/Local State'

def get_chrome_key():
    """Get Chrome's AES key from macOS Keychain."""
    result = subprocess.run(
        ['security', 'find-generic-password', '-w', '-a', 'Chrome', '-s', 'Chrome Safe Storage'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"Keychain access failed: {result.stderr}")
    return result.stdout.strip()

def decrypt_cookie(encrypted_value, key_bytes):
    """Decrypt Chrome cookie (AES-128-CBC, key derived from keychain password)."""
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.backends import default_backend
        import hashlib, base64

        # Chrome on Mac uses PBKDF2 with the keychain password
        password = key_bytes.encode() if isinstance(key_bytes, str) else key_bytes
        salt = b'saltysalt'
        iv = b' ' * 16
        iterations = 1003

        derived = hashlib.pbkdf2_hmac('sha1', password, salt, iterations, dklen=16)

        # Remove the 'v10' prefix
        raw = encrypted_value[3:]
        cipher = Cipher(algorithms.AES(derived), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        decrypted = decryptor.update(raw) + decryptor.finalize()

        # Remove PKCS7 padding
        pad_len = decrypted[-1]
        return decrypted[:-pad_len].decode('utf-8')
    except Exception as e:
        return None

def main():
    if not CHROME_COOKIES.exists():
        print("ERROR: Chrome cookies not found")
        sys.exit(1)

    try:
        key = get_chrome_key()
    except Exception as e:
        print(f"ERROR getting keychain key: {e}")
        print("Make sure Chrome is closed and try again.")
        sys.exit(1)

    # Copy DB to temp (avoid lock issues)
    import shutil, tempfile
    tmp = tempfile.mktemp(suffix='.db')
    shutil.copy2(CHROME_COOKIES, tmp)

    conn = sqlite3.connect(tmp)
    rows = conn.execute(
        "SELECT host_key, name, encrypted_value FROM cookies WHERE host_key LIKE '%suno%'"
    ).fetchall()
    conn.close()
    os.unlink(tmp)

    result = {}
    for host, name, enc_val in rows:
        if enc_val:
            val = decrypt_cookie(enc_val, key)
            if val:
                result[name] = {'host': host, 'value': val}

    # Print key cookies
    for name in ['__session', '__client_uat', 'sessionid']:
        if name in result:
            print(f"{name}: {result[name]['value'][:120]}")
        else:
            print(f"{name}: NOT FOUND")

    # Save to JSON for worker
    out = Path.home() / 'suno-worker/suno-session.json'
    with open(out, 'w') as f:
        json.dump({k: v['value'] for k, v in result.items()}, f)
    print(f"\nSaved to {out}")

if __name__ == '__main__':
    main()
