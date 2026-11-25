# QMODSIM materials

The [verification report](VERIFICATION.md) documents all seven models, assumptions, formulas, worked calculations and application links. The [archived result](qmodsim_results.json) is preserved. Rerun outputs are under [evidence](evidence/).

The standalone programs use scenario inputs. The POS lab is implemented in `tagak-coffee/pos-app/js/qmodsim.js`; its authenticated telemetry endpoint reads branch-level operational records. Financial loss and reliability estimates are model outputs. The offline queue uses a digest for consistency checking; an unkeyed digest does not establish authorship.
