import test from "ava"
import {Channel} from '../'
import {isFunction, isObject} from 'sav-util'

test ("rtc#api", ava =>{
	const channel = new Channel()


	ava.true(isFunction(channel.listen))
	ava.true(isFunction(channel.unlisten))
	ava.true(isFunction(channel.createSender))
	
	ava.true(isFunction(channel.on))
	ava.true(isFunction(channel.off))
	ava.true(isFunction(channel.once))

	const sender = channel.createSender({})

	ava.true(isObject(sender))
})