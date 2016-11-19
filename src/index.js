import {Channel} from './channel'

export {Channel}

export function install ({prop}, opts) {
  prop.val('rpc', new Channel(opts))
}
