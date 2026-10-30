export class SignInController {
    signIn;
    constructor(signIn) {
        this.signIn = signIn;
    }
    async handle(req, res) {
        res.status(200).json(await this.signIn.execute(req.body));
    }
}
