from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Kiểm tra mật khẩu thường với mật khẩu đã được băm."""
    return pwd_context.verify(plain_password, hashed_password)

def hash_password(password: str) -> str:
    """Băm mật khẩu."""
    return pwd_context.hash(password)