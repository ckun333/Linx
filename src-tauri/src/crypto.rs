use std::fs;
use std::io::Read;
use std::path::PathBuf;

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{Context, Result};
use base64::Engine;
use rand::RngCore;

/// AES-256-GCM 加密服务
///
/// 密钥存储在 ~/.linx/.key 文件中，仅当前用户可读。
/// 加密输出格式：base64(随机12字节nonce || 密文)
pub struct CryptoService {
    key: [u8; 32],
}

impl CryptoService {
    /// 初始化加密服务
    ///
    /// 如果 ~/.linx/.key 不存在则生成新密钥并保存，
    /// 否则从已有文件加载密钥。
    pub fn new() -> Result<Self> {
        let key_path = Self::key_path()?;

        let key = if key_path.exists() {
            Self::load_key(&key_path)?
        } else {
            let key = Self::generate_key();
            Self::save_key(&key_path, &key)?;
            key
        };

        Ok(Self { key })
    }

    /// 获取密钥文件路径
    fn key_path() -> Result<PathBuf> {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .context("无法获取用户主目录")?;

        let dir = PathBuf::from(&home).join(".linx");
        Ok(dir.join(".key"))
    }

    /// 生成 256 位随机密钥
    fn generate_key() -> [u8; 32] {
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        key
    }

    /// 将密钥保存到文件（仅当前用户可读写）
    fn save_key(path: &std::path::Path, key: &[u8; 32]) -> Result<()> {
        // 确保目录存在
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).context("无法创建 .linx 目录")?;
        }

        fs::write(path, key).context("无法写入密钥文件")?;

        // 仅 Unix 系统设置文件权限
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .context("无法设置密钥文件权限")?;
        }

        Ok(())
    }

    /// 从文件加载密钥
    fn load_key(path: &std::path::Path) -> Result<[u8; 32]> {
        let mut file = fs::File::open(path).context("无法打开密钥文件")?;
        let mut key = [0u8; 32];
        file.read_exact(&mut key).context("读取密钥文件失败")?;
        Ok(key)
    }

    /// 加密明文
    ///
    /// 返回 base64 编码的字符串，格式为：nonce (12字节) + ciphertext
    pub fn encrypt(&self, plaintext: &str) -> Result<String> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("AES 初始化失败: {}", e))?;

        // 生成随机 96 位 nonce
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| anyhow::anyhow!("加密失败: {}", e))?;

        // 拼接 nonce + ciphertext 后 base64 编码
        let mut combined = Vec::with_capacity(12 + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);

        Ok(base64::engine::general_purpose::STANDARD.encode(&combined))
    }

    /// 解密密文
    ///
    /// 输入为 base64 编码的字符串，格式为：nonce (12字节) + ciphertext
    pub fn decrypt(&self, ciphertext_b64: &str) -> Result<String> {
        let combined = base64::engine::general_purpose::STANDARD
            .decode(ciphertext_b64)
            .context("base64 解码失败")?;

        if combined.len() < 12 {
            anyhow::bail!("密文数据不完整");
        }

        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("AES 初始化失败: {}", e))?;

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("解密失败: {}", e))?;

        String::from_utf8(plaintext).context("解密结果不是有效 UTF-8")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    static INIT: Once = Once::new();

    /// 初始化测试环境：确保 HOME 可用
    fn setup() {
        INIT.call_once(|| {
            if std::env::var("HOME").is_err() {
                std::env::set_var("HOME", "/tmp");
            }
        });
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        setup();
        let crypto = CryptoService::new().unwrap();
        let plaintext = "Hello, Linx! 测试中文密码";

        let encrypted = crypto.encrypt(plaintext).unwrap();
        assert_ne!(encrypted, plaintext);
        assert!(!encrypted.is_empty());

        let decrypted = crypto.decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_empty_string() {
        setup();
        let crypto = CryptoService::new().unwrap();

        let encrypted = crypto.encrypt("").unwrap();
        let decrypted = crypto.decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, "");
    }

    #[test]
    fn test_different_encryptions_different() {
        setup();
        let crypto = CryptoService::new().unwrap();
        let plaintext = "same text";

        let e1 = crypto.encrypt(plaintext).unwrap();
        let e2 = crypto.encrypt(plaintext).unwrap();

        // 由于随机 nonce，每次加密结果应不同
        assert_ne!(e1, e2);

        // 但解密结果应相同
        assert_eq!(crypto.decrypt(&e1).unwrap(), plaintext);
        assert_eq!(crypto.decrypt(&e2).unwrap(), plaintext);
    }

    #[test]
    fn test_decrypt_invalid_data() {
        setup();
        let crypto = CryptoService::new().unwrap();

        assert!(crypto.decrypt("invalid-base64!!!").is_err());
        assert!(crypto.decrypt("aa").is_err()); // 长度 < 12
    }


}
