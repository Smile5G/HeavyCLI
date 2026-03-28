"""
Crypto Vault — PIN-based encryption for settings.json.
Uses Scrypt KDF to derive a 256-bit key from the PIN,
then AES-256-GCM to encrypt/decrypt the settings payload.
"""

import json
import os
import base64
from pathlib import Path
from typing import Optional

from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

# Default vault location
VAULT_DIR = Path(os.environ.get("HEAVY_VAULT_DIR", Path.home() / ".heavy"))
VAULT_FILE = VAULT_DIR / "vault.enc"

# Scrypt parameters (N=2^17, r=8, p=1 — ~130ms on modern hardware)
SCRYPT_N = 2**17
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_LENGTH = 32  # 256-bit key


class VaultError(Exception):
    """Raised when vault operations fail."""
    pass


class CryptoVault:
    """
    Manages encrypted settings storage.

    On first run, the user sets a PIN. The vault encrypts an initial
    empty settings dict and writes it to disk. On subsequent runs,
    the PIN is used to decrypt the settings into memory.
    """

    def __init__(self, vault_path: Optional[Path] = None):
        self.vault_path = vault_path or VAULT_FILE
        self._decrypted_settings: Optional[dict] = None
        self._derived_key: Optional[bytes] = None

    @property
    def is_initialized(self) -> bool:
        """Check if vault file exists (first-run detection)."""
        return self.vault_path.exists()

    @property
    def is_unlocked(self) -> bool:
        """Check if settings are currently decrypted in memory."""
        return self._decrypted_settings is not None

    @property
    def settings(self) -> dict:
        """Get decrypted settings. Raises if vault is locked."""
        if self._decrypted_settings is None:
            raise VaultError("Vault is locked. Authenticate first.")
        return self._decrypted_settings

    def _derive_key(self, pin: str, salt: bytes) -> bytes:
        """Derive a 256-bit key from PIN + salt using Scrypt."""
        kdf = Scrypt(
            salt=salt,
            length=SCRYPT_LENGTH,
            n=SCRYPT_N,
            r=SCRYPT_R,
            p=SCRYPT_P,
        )
        return kdf.derive(pin.encode("utf-8"))

    def initialize(self, pin: str, initial_settings: Optional[dict] = None) -> dict:
        """
        First-run: create the vault with a new PIN.
        Returns the initial settings dict.
        """
        if self.is_initialized:
            raise VaultError("Vault already initialized. Use unlock() instead.")

        settings = initial_settings or {
            "server_host": "",
            "server_port": 8000,
            "ssh_user": "",
            "ssh_key_path": "",
            "tailscale_ip": "",
            "wol_mac": "",
            "wol_broadcast": "",
        }

        # Generate random salt and nonce
        salt = os.urandom(32)
        nonce = os.urandom(12)  # 96-bit for AES-GCM

        # Derive key and encrypt
        key = self._derive_key(pin, salt)
        aesgcm = AESGCM(key)
        plaintext = json.dumps(settings).encode("utf-8")
        ciphertext = aesgcm.encrypt(nonce, plaintext, None)

        # Save vault to disk
        vault_data = {
            "salt": base64.b64encode(salt).decode(),
            "nonce": base64.b64encode(nonce).decode(),
            "ciphertext": base64.b64encode(ciphertext).decode(),
        }

        self.vault_path.parent.mkdir(parents=True, exist_ok=True)
        self.vault_path.write_text(json.dumps(vault_data, indent=2))

        # Keep in memory
        self._derived_key = key
        self._decrypted_settings = settings

        return settings

    def unlock(self, pin: str) -> dict:
        """
        Subsequent runs: decrypt settings with PIN.
        Returns the decrypted settings dict.
        Raises VaultError if PIN is wrong.
        """
        if not self.is_initialized:
            raise VaultError("Vault not initialized. Use initialize() first.")

        vault_data = json.loads(self.vault_path.read_text())
        salt = base64.b64decode(vault_data["salt"])
        nonce = base64.b64decode(vault_data["nonce"])
        ciphertext = base64.b64decode(vault_data["ciphertext"])

        key = self._derive_key(pin, salt)
        aesgcm = AESGCM(key)

        try:
            plaintext = aesgcm.decrypt(nonce, ciphertext, None)
        except InvalidTag:
            raise VaultError("Invalid PIN. Decryption failed.")

        self._derived_key = key
        self._decrypted_settings = json.loads(plaintext.decode("utf-8"))

        return self._decrypted_settings

    def update_settings(self, updates: dict) -> dict:
        """
        Update settings in memory and re-encrypt to disk.
        Must be unlocked first.
        """
        if not self.is_unlocked or self._derived_key is None:
            raise VaultError("Vault is locked. Authenticate first.")

        self._decrypted_settings.update(updates)

        # Re-encrypt with a fresh nonce
        vault_data = json.loads(self.vault_path.read_text())
        salt = base64.b64decode(vault_data["salt"])
        nonce = os.urandom(12)

        aesgcm = AESGCM(self._derived_key)
        plaintext = json.dumps(self._decrypted_settings).encode("utf-8")
        ciphertext = aesgcm.encrypt(nonce, plaintext, None)

        vault_data["nonce"] = base64.b64encode(nonce).decode()
        vault_data["ciphertext"] = base64.b64encode(ciphertext).decode()
        self.vault_path.write_text(json.dumps(vault_data, indent=2))

        return self._decrypted_settings

    def lock(self) -> None:
        """Clear decrypted settings from memory."""
        self._decrypted_settings = None
        self._derived_key = None

    def change_pin(self, old_pin: str, new_pin: str) -> None:
        """Change the vault PIN. Re-encrypts with new key."""
        # Verify old PIN
        settings = self.unlock(old_pin)

        # Re-encrypt with new PIN
        salt = os.urandom(32)
        nonce = os.urandom(12)
        key = self._derive_key(new_pin, salt)
        aesgcm = AESGCM(key)
        plaintext = json.dumps(settings).encode("utf-8")
        ciphertext = aesgcm.encrypt(nonce, plaintext, None)

        vault_data = {
            "salt": base64.b64encode(salt).decode(),
            "nonce": base64.b64encode(nonce).decode(),
            "ciphertext": base64.b64encode(ciphertext).decode(),
        }
        self.vault_path.write_text(json.dumps(vault_data, indent=2))
        self._derived_key = key
