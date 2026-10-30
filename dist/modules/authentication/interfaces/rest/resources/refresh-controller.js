export class RefreshController {
    refresh;
    constructor(refresh) {
        this.refresh = refresh;
    }
    async handle(req, res) { res.status(200).json(await this.refresh.execute(req.body)); }
}
