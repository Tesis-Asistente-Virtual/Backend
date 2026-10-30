export class SignOutController {
    signOut;
    constructor(signOut) {
        this.signOut = signOut;
    }
    async handle(req, res) { await this.signOut.execute(req.body); res.status(204).end(); }
}
