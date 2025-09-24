const bcrypt = await import('bcrypt');
const hash = await bcrypt.default.hash('admin1234', 10);
console.log(hash);