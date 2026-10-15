/** Error yang pesannya aman ditampilkan langsung ke member. */
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

module.exports = { UserError };
